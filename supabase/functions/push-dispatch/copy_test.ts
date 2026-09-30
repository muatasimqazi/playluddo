// cd supabase/functions/push-dispatch && deno test
import { assert, assertEquals } from "@std/assert";
import { PUSH_COPY, PUSH_LOCALES, pushLocale, pushText } from "./copy.ts";

Deno.test("every language has exactly the English keys, all filled in", () => {
  const keys = Object.keys(PUSH_COPY.en).sort();
  for (const locale of PUSH_LOCALES) {
    assertEquals(Object.keys(PUSH_COPY[locale]).sort(), keys, locale);
    for (const [key, value] of Object.entries(PUSH_COPY[locale])) {
      assert(value.trim().length > 0, `${locale}.${key} is empty`);
      // Placeholders must match English so interpolation never drops a name.
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      assertEquals(placeholders(value), placeholders(PUSH_COPY.en[key as keyof typeof PUSH_COPY.en]), `${locale}.${key}`);
    }
  }
});

Deno.test("device locales resolve to a supported language", () => {
  assertEquals(pushLocale("pt-BR"), "pt-BR");
  assertEquals(pushLocale("pt"), "pt-BR");
  assertEquals(pushLocale("ur-PK"), "ur");
  assertEquals(pushLocale("en_US"), "en");
  assertEquals(pushLocale("fr"), "en");
  assertEquals(pushLocale(null), "en");
});

Deno.test("names are filled in and clipped, and a nameless rematch still reads well", () => {
  assertEquals(pushText("friend_table", "en", { name: "Sara" }).title, "Sara opened a table");
  assertEquals(
    pushText("team_table", "es", { name: "Sara", team: "Tuesday Club" }),
    { title: "Tuesday Club está jugando", body: "Sara abrió una mesa para tu equipo. Toca para unirte." },
  );
  assertEquals(pushText("rematch", "en", { name: "" }).body, PUSH_COPY.en.rematchBodyAnon);
  assertEquals(pushText("friend_table", "en", { name: "x".repeat(80) }).title.length, 32 + " opened a table".length);
});
