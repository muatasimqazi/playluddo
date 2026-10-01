#!/usr/bin/env node
/**
 * The call-connection insights for V1 (docs/COMPETITIVE_ROADMAP.md Section 7):
 * the failure rate of table calls, from the one `call_ice_outcome` event each
 * peer connection sends (lib/analytics/ice.ts), against the <2% target.
 *
 *   node scripts/posthog-ice-insights.mjs            # create or update both insights
 *   node scripts/posthog-ice-insights.mjs --check    # print the last 7 days' numbers
 *   node scripts/posthog-ice-insights.mjs --dry-run  # show what would be sent
 *
 * Needs a personal API key (PostHog → Settings → Personal API keys) with
 * insight:write and query:read, and the project ID from the project settings:
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_... POSTHOG_PROJECT_ID=12345 node scripts/posthog-ice-insights.mjs
 *
 * POSTHOG_HOST defaults to https://us.posthog.com (use https://eu.posthog.com
 * for an EU project). Insights are matched by name, so rerunning updates them
 * in place. The ">2%" alert is added on the saved insight in PostHog
 * (Alerts → New alert → "has value", more than 2).
 */

const host = (process.env.POSTHOG_HOST ?? "https://us.posthog.com").replace(/\/$/, "");
const key = process.env.POSTHOG_PERSONAL_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const EVENT = "call_ice_outcome";
const outcome = (value) => ({ key: "outcome", value: [value], operator: "exact", type: "event" });

/** Failed connections as a percentage of all that finished (connected + failed). */
function failureRate(breakdown) {
  return {
    kind: "InsightVizNode",
    source: {
      kind: "TrendsQuery",
      dateRange: { date_from: "-7d" },
      interval: "day",
      series: [
        { kind: "EventsNode", event: EVENT, name: EVENT, math: "total", properties: [outcome("failed")] },
        {
          kind: "EventsNode",
          event: EVENT,
          name: EVENT,
          math: "total",
          properties: [{ key: "outcome", value: ["connected", "failed"], operator: "exact", type: "event" }],
        },
      ],
      trendsFilter: { formula: "A / B * 100", display: "ActionsLineGraph", aggregationAxisFormat: "percentage" },
      breakdownFilter: { breakdown, breakdown_type: "event" },
      version: 2,
    },
  };
}

const INSIGHTS = [
  {
    name: "Call connection failure rate",
    description:
      "V1: failed / (connected + failed) per day for call_ice_outcome, by whether the table carries video. Target under 2%.",
    query: failureRate("video_table"),
  },
  {
    name: "Call connection failure rate by TURN",
    description:
      "V1: the same rate by turn_offered. High only where turn_offered is false means the ice-servers function failed and calls fell back to STUN only.",
    query: failureRate("turn_offered"),
  },
];

const CHECK_QUERY = `
  select
    countIf(properties.outcome = 'failed') as failed,
    countIf(properties.outcome = 'connected') as connected,
    round(100 * failed / nullIf(failed + connected, 0), 2) as failure_pct,
    countIf(properties.outcome = 'connected' and properties.candidate_type = 'relay') as via_relay,
    countIf(toString(properties.turn_offered) = 'false') as without_turn,
    round(quantile(0.5)(toFloat(properties.ms))) as median_ms
  from events
  where event = '${EVENT}' and timestamp > now() - interval 7 day
`;

async function api(path, init = {}) {
  const response = await fetch(`${host}/api/projects/${project}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function upsert({ name, description, query }) {
  const found = await api(`/insights/?search=${encodeURIComponent(name)}&saved=true`);
  const existing = found.results?.find((insight) => insight.name === name && !insight.deleted);
  const body = JSON.stringify({ name, description, query, saved: true });
  const saved = existing
    ? await api(`/insights/${existing.id}/`, { method: "PATCH", body })
    : await api(`/insights/`, { method: "POST", body });
  console.log(`${existing ? "Updated" : "Created"} "${name}": ${host}/project/${project}/insights/${saved.short_id}`);
}

async function check() {
  const result = await api(`/query/`, {
    method: "POST",
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: CHECK_QUERY } }),
  });
  const [row] = result.results ?? [];
  const columns = result.columns ?? [];
  if (!row) return console.log("No call_ice_outcome events in the last 7 days.");
  const values = Object.fromEntries(columns.map((column, i) => [column, row[i]]));
  console.log("Last 7 days of call_ice_outcome:");
  console.log(`  connected ${values.connected}, failed ${values.failed}, failure rate ${values.failure_pct ?? "n/a"}% (target < 2%)`);
  console.log(`  connected through the TURN relay: ${values.via_relay}`);
  console.log(`  connections offered no TURN (STUN-only fallback): ${values.without_turn}`);
  console.log(`  median time to an outcome: ${values.median_ms ?? "n/a"} ms`);
}

if (dryRun) {
  for (const insight of INSIGHTS) console.log(JSON.stringify(insight, null, 2));
  console.log(CHECK_QUERY);
  process.exit(0);
}
if (!key || !project) {
  console.error("Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (see the comment at the top of this file).");
  process.exit(1);
}
try {
  if (args.has("--check")) await check();
  else for (const insight of INSIGHTS) await upsert(insight);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
