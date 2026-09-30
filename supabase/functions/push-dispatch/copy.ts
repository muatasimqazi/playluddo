/**
 * What each push says, in the first-wave languages (lib/i18n/locales.ts).
 * Kept here rather than in lib/i18n/messages because the Edge Function
 * can't import from the app; copy_test.ts holds every language to the
 * English key set. Non-English copy is machine-drafted and needs native
 * review, like the app's catalogs.
 */

export const PUSH_LOCALES = ["en", "hi", "ur", "ar", "bn", "id", "es", "pt-BR"] as const;
export type PushLocale = (typeof PUSH_LOCALES)[number];

const en = {
  turnTitle: "Your turn",
  turnBody: "Everyone's waiting on your roll.",
  rematchTitle: "Rematch?",
  rematchBody: "{name} wants a rematch. You've got a minute to join.",
  rematchBodyAnon: "Someone wants a rematch. You've got a minute to join.",
  friendTitle: "{name} opened a table",
  friendBody: "Tap to take a seat.",
  teamTitle: "{team} is playing",
  teamBody: "{name} opened a table for your team. Tap to join.",
};

export type PushCopy = typeof en;

export const PUSH_COPY: Record<PushLocale, PushCopy> = {
  en,
  hi: {
    turnTitle: "आपकी बारी",
    turnBody: "सब आपके पासे का इंतज़ार कर रहे हैं।",
    rematchTitle: "फिर से खेलें?",
    rematchBody: "{name} फिर से खेलना चाहते हैं। जुड़ने के लिए आपके पास एक मिनट है।",
    rematchBodyAnon: "कोई फिर से खेलना चाहता है। जुड़ने के लिए आपके पास एक मिनट है।",
    friendTitle: "{name} ने एक टेबल खोली है",
    friendBody: "सीट लेने के लिए टैप करें।",
    teamTitle: "{team} खेल रही है",
    teamBody: "{name} ने आपकी टीम के लिए टेबल खोली है। जुड़ने के लिए टैप करें।",
  },
  ur: {
    turnTitle: "آپ کی باری",
    turnBody: "سب آپ کے پانسے کا انتظار کر رہے ہیں۔",
    rematchTitle: "دوبارہ کھیلیں؟",
    rematchBody: "{name} دوبارہ کھیلنا چاہتے ہیں۔ شامل ہونے کے لیے آپ کے پاس ایک منٹ ہے۔",
    rematchBodyAnon: "کوئی دوبارہ کھیلنا چاہتا ہے۔ شامل ہونے کے لیے آپ کے پاس ایک منٹ ہے۔",
    friendTitle: "{name} نے ایک میز کھولی ہے",
    friendBody: "نشست لینے کے لیے ٹیپ کریں۔",
    teamTitle: "{team} کھیل رہی ہے",
    teamBody: "{name} نے آپ کی ٹیم کے لیے میز کھولی ہے۔ شامل ہونے کے لیے ٹیپ کریں۔",
  },
  ar: {
    turnTitle: "دورك",
    turnBody: "الجميع بانتظار رميتك.",
    rematchTitle: "مباراة أخرى؟",
    rematchBody: "{name} يريد مباراة أخرى. أمامك دقيقة للانضمام.",
    rematchBodyAnon: "أحدهم يريد مباراة أخرى. أمامك دقيقة للانضمام.",
    friendTitle: "{name} فتح طاولة",
    friendBody: "انقر لتأخذ مقعدًا.",
    teamTitle: "فريق {team} يلعب",
    teamBody: "{name} فتح طاولة لفريقك. انقر للانضمام.",
  },
  bn: {
    turnTitle: "আপনার পালা",
    turnBody: "সবাই আপনার চালের অপেক্ষায়।",
    rematchTitle: "আবার খেলবেন?",
    rematchBody: "{name} আবার খেলতে চান। যোগ দিতে আপনার হাতে এক মিনিট আছে।",
    rematchBodyAnon: "কেউ আবার খেলতে চান। যোগ দিতে আপনার হাতে এক মিনিট আছে।",
    friendTitle: "{name} একটি টেবিল খুলেছেন",
    friendBody: "আসন নিতে ট্যাপ করুন।",
    teamTitle: "{team} খেলছে",
    teamBody: "{name} আপনার দলের জন্য একটি টেবিল খুলেছেন। যোগ দিতে ট্যাপ করুন।",
  },
  id: {
    turnTitle: "Giliranmu",
    turnBody: "Semua menunggu lemparan dadumu.",
    rematchTitle: "Main lagi?",
    rematchBody: "{name} ingin main lagi. Kamu punya satu menit untuk bergabung.",
    rematchBodyAnon: "Seseorang ingin main lagi. Kamu punya satu menit untuk bergabung.",
    friendTitle: "{name} membuka meja",
    friendBody: "Ketuk untuk duduk.",
    teamTitle: "{team} sedang bermain",
    teamBody: "{name} membuka meja untuk timmu. Ketuk untuk bergabung.",
  },
  es: {
    turnTitle: "Tu turno",
    turnBody: "Todos esperan tu tirada.",
    rematchTitle: "¿Revancha?",
    rematchBody: "{name} quiere la revancha. Tienes un minuto para unirte.",
    rematchBodyAnon: "Alguien quiere la revancha. Tienes un minuto para unirte.",
    friendTitle: "{name} abrió una mesa",
    friendBody: "Toca para sentarte.",
    teamTitle: "{team} está jugando",
    teamBody: "{name} abrió una mesa para tu equipo. Toca para unirte.",
  },
  "pt-BR": {
    turnTitle: "Sua vez",
    turnBody: "Todos estão esperando você jogar o dado.",
    rematchTitle: "Revanche?",
    rematchBody: "{name} quer uma revanche. Você tem um minuto para entrar.",
    rematchBodyAnon: "Alguém quer uma revanche. Você tem um minuto para entrar.",
    friendTitle: "{name} abriu uma mesa",
    friendBody: "Toque para se sentar.",
    teamTitle: "{team} está jogando",
    teamBody: "{name} abriu uma mesa para o seu time. Toque para entrar.",
  },
};

/** "pt-BR", "pt", "ur-PK" and "en-US" all find their language; anything else is English. */
export function pushLocale(tag: string | null | undefined): PushLocale {
  if (!tag) return "en";
  const exact = PUSH_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.toLowerCase().split(/[-_]/)[0];
  return PUSH_LOCALES.find((l) => l.toLowerCase().split("-")[0] === language) ?? "en";
}

export type PushKind = "turn" | "rematch" | "friend_table" | "team_table";

// Names are player-chosen; keep a long one from crowding out the message.
const clip = (value: unknown) => String(value ?? "").trim().slice(0, 32);

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

export function pushText(
  kind: PushKind,
  locale: string | null | undefined,
  data: Record<string, unknown>,
): { title: string; body: string } {
  const copy = PUSH_COPY[pushLocale(locale)];
  const values = { name: clip(data.name), team: clip(data.team) };
  switch (kind) {
    case "turn":
      return { title: copy.turnTitle, body: copy.turnBody };
    case "rematch":
      return {
        title: copy.rematchTitle,
        body: values.name ? fill(copy.rematchBody, values) : copy.rematchBodyAnon,
      };
    case "friend_table":
      return { title: fill(copy.friendTitle, values), body: copy.friendBody };
    case "team_table":
      return { title: fill(copy.teamTitle, values), body: fill(copy.teamBody, values) };
  }
}
