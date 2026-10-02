import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, PARAMETER_NAMES, USER_PROPERTY_NAMES } from "../../lib/analytics/events";
import { buildGtmContainer, catalogRegex, GA_MEASUREMENT_ID, READY_EVENT } from "../../scripts/generate-gtm-container";

const container = buildGtmContainer().containerVersion;
const text = JSON.stringify(container);

describe("the GTM container", () => {
  it("matches exactly the catalog's event names", () => {
    const regex = new RegExp(catalogRegex());
    for (const name of EVENT_NAMES) expect(regex.test(name)).toBe(true);
    for (const other of [READY_EVENT, "gtm.js", "gtm.dom", "purchase", "page_view_extra", "xpage_view"])
      expect(regex.test(other)).toBe(false);
  });

  it("has a variable for every parameter and user property", () => {
    const names = new Set(container.variable.map((v) => v.name));
    for (const name of PARAMETER_NAMES)
      expect(names.has(`DLV - luddo.${name}`) || names.has(`DLV - ${name}`)).toBe(true);
    for (const name of USER_PROPERTY_NAMES) expect(names.has(`DLV - luddo_user.${name}`)).toBe(true);
  });

  it("starts the Google tag on luddo_ready with page views off", () => {
    const googleTag = container.tag.find((t) => t.type === "googtag")!;
    const trigger = container.trigger.find((t) => t.triggerId === googleTag.firingTriggerId[0])!;
    expect(JSON.stringify(trigger.customEventFilter)).toContain(READY_EVENT);
    expect(JSON.stringify(googleTag.parameter)).toContain('"send_page_view"},{"type":"TEMPLATE","key":"parameterValue","value":"false"');
  });

  it("needs analytics consent on every tag, and sends to Luddo House's property only", () => {
    for (const tag of container.tag) expect(JSON.stringify(tag.consentSettings)).toContain("analytics_storage");
    expect(text.match(/G-[A-Z0-9]+/g)?.every((id) => id === GA_MEASUREMENT_ID)).toBe(true);
  });

  it("spells the game Luddo", () => {
    expect(text).not.toMatch(/\bludo\b/i);
  });

  it("is the file in docs, regenerated", () => {
    const file = JSON.parse(readFileSync(new URL("../../docs/gtm-container.json", import.meta.url), "utf8"));
    const fresh = buildGtmContainer({
      accountId: file.containerVersion.accountId,
      containerId: file.containerVersion.containerId,
    });
    // Everything but the time it was written.
    expect({ ...file, exportTime: "" }).toEqual(JSON.parse(JSON.stringify({ ...fresh, exportTime: "" })));
  });
});
