import { LegacyTournamentRedirect } from "./LegacyTournamentRedirect";

// Legacy path route. Tournament detail moved to the query-param route
// `/tournaments/view?id=…` so it prerenders under the Capacitor static export
// (`output: "export"`) — arbitrary tournament IDs can't be enumerated for a
// `[id]` segment. `output: "export"` still requires at least one generated
// route, so we emit a single placeholder page whose only job is to redirect
// the real id (read at runtime) to the new URL. On the dynamic web build this
// also transparently forwards any old `/tournaments/<id>` deep link.
export function generateStaticParams(): { id: string }[] {
  return [{ id: "_" }];
}

export default function LegacyTournamentPage() {
  return <LegacyTournamentRedirect />;
}
