import type { Lang, Localized, Scheme, SchemeResult } from "../engine/index.js";

// Spoken text is built from templates + verified scheme data, so amounts and documents are never paraphrased by the LLM.
// The LLM only contributes short answers to free-form follow-up questions.
// "en" is for testing the flow in text chat; callers hear hi or mr.

const T = {
  greeting: {
    hi: "नमस्ते! योजना दर्शक में आपका स्वागत है। यहाँ आपको सरकारी योजनाओं की मुफ़्त जानकारी मिलेगी। हम कभी आपका आधार नंबर, बैंक खाता या ओटीपी नहीं माँगेंगे। मराठी में बात करनी हो तो बताइए। बताइए, आपको किस चीज़ में मदद चाहिए?",
    mr: "नमस्कार! योजना दर्शकमध्ये तुमचे स्वागत आहे. इथे तुम्हाला सरकारी योजनांची मोफत माहिती मिळेल. आम्ही कधीही तुमचा आधार नंबर, बँक खाते किंवा ओटीपी मागणार नाही. सांगा, तुम्हाला कशाबद्दल मदत हवी आहे?",
    en: "Hello! Welcome to Yojana Darshak. You can get free information about government schemes here. We will never ask for your Aadhaar number, bank account or OTP. Tell me, what do you need help with?",
  },
  switched: { hi: "ठीक है, अब हिंदी में बात करते हैं।", mr: "ठीक आहे, आता मराठीत बोलूया.", en: "Okay, let's continue in English." },
  meantYou: { hi: "मैं आपके अपने बारे में पूछ रही हूँ।", mr: "मी तुमच्या स्वतःबद्दल विचारत आहे.", en: "I meant you yourself." },
  sorry: { hi: "माफ़ कीजिए, ठीक से समझ नहीं आया।", mr: "माफ करा, नीट समजले नाही.", en: "Sorry, I didn't quite get that." },
  scamWarning: {
    hi: "सावधान! सरकारी योजना में आवेदन बिल्कुल मुफ़्त है। कोई पैसे, ओटीपी या आधार नंबर माँगे तो मत दीजिए। सीधे अपने नज़दीकी सीएससी केंद्र या सरकारी दफ़्तर जाइए।",
    mr: "सावध राहा! सरकारी योजनेसाठी अर्ज पूर्णपणे मोफत आहे. कोणी पैसे, ओटीपी किंवा आधार नंबर मागितला तर देऊ नका. थेट जवळच्या सीएससी केंद्रावर किंवा सरकारी कार्यालयात जा.",
    en: "Be careful! Applying for a government scheme is completely free. If anyone asks for money, an OTP or your Aadhaar number, don't give it. Go directly to your nearest CSC centre or government office.",
  },
  eligibleIntro: { hi: "आप इन योजनाओं के लिए पात्र हैं।", mr: "तुम्ही या योजनांसाठी पात्र आहात.", en: "You are eligible for these schemes." },
  likelyIntro: {
    hi: "आप इन योजनाओं के लिए शायद पात्र हो सकते हैं, सीएससी पर पक्का कर लीजिए।",
    mr: "तुम्ही या योजनांसाठी कदाचित पात्र असाल, सीएससीवर खात्री करून घ्या.",
    en: "You may be eligible for these schemes; please confirm at a CSC.",
  },
  more: (n: number): Localized => ({
    hi: `और भी ${n} योजनाएँ हैं, सुनना चाहेंगे? या किसी योजना के बारे में विस्तार से जानना है?`,
    mr: `आणखी ${n} योजना आहेत, ऐकायच्या का? की एखाद्या योजनेबद्दल सविस्तर माहिती हवी?`,
    en: `There ${n === 1 ? "is 1 more scheme" : `are ${n} more schemes`}. Would you like to hear them, or hear details of one scheme?`,
  }),
  pick: {
    hi: "किस योजना के बारे में विस्तार से जानना चाहेंगे?",
    mr: "कोणत्या योजनेबद्दल सविस्तर माहिती हवी?",
    en: "Which scheme would you like details about?",
  },
  noneFound: {
    hi: "आपकी बताई जानकारी से अभी कोई योजना पक्की नहीं हुई।",
    mr: "तुम्ही दिलेल्या माहितीवरून अजून कोणतीही योजना निश्चित झाली नाही.",
    en: "From what you've told me, no scheme is confirmed yet.",
  },
  checkOthers: {
    hi: "कुछ और तरह की योजनाएँ भी हो सकती हैं, जैसे बीमा, पेंशन या स्वास्थ्य। देखें?",
    mr: "आणखी काही प्रकारच्या योजना असू शकतात, जसे विमा, पेन्शन किंवा आरोग्य. पाहूया का?",
    en: "There may be other kinds of schemes too, like insurance, pension or health. Shall we check?",
  },
  goWith: (docs: string, where: string): Localized => ({
    hi: `इसके लिए ${docs} लेकर ${where} जाइए।`,
    mr: `यासाठी ${docs} घेऊन ${where} जा.`,
    en: `For this, take your ${docs} ${where}.`,
  }),
  anythingElse: {
    hi: "किसी और योजना के बारे में जानना है?",
    mr: "आणखी कोणत्या योजनेबद्दल जाणून घ्यायचे आहे का?",
    en: "Would you like to know about any other scheme?",
  },
  consent: {
    hi: "क्या यह जानकारी इसी नंबर पर मैसेज कर दें? किसी और नंबर पर चाहिए तो वह नंबर बताइए।",
    mr: "ही माहिती याच नंबरवर मेसेज करू का? दुसऱ्या नंबरवर हवी असल्यास तो नंबर सांगा.",
    en: "Shall I send this information as a message to this number? If you want it on another number, tell me that number.",
  },
  consentNoNumber: {
    hi: "क्या यह जानकारी एसएमएस से भेज दें? भेजनी हो तो अपना मोबाइल नंबर बताइए।",
    mr: "ही माहिती एसएमएसने पाठवू का? पाठवायची असल्यास तुमचा मोबाईल नंबर सांगा.",
    en: "Shall I send this information by SMS? If yes, tell me your mobile number.",
  },
  askNumber: { hi: "अपना दस अंकों का मोबाइल नंबर बताइए।", mr: "तुमचा दहा अंकी मोबाईल नंबर सांगा.", en: "Please tell me your 10-digit mobile number." },
  badNumber: { hi: "यह नंबर ठीक से समझ नहीं आया।", mr: "हा नंबर नीट समजला नाही.", en: "I couldn't catch that number." },
  closingSent: {
    hi: "ठीक है, आपको मैसेज मिल जाएगा। याद रखिए, सरकारी योजनाएँ बिल्कुल मुफ़्त हैं, कोई पैसे माँगे तो मत दीजिए। धन्यवाद!",
    mr: "ठीक आहे, तुम्हाला मेसेज मिळेल. लक्षात ठेवा, सरकारी योजना पूर्णपणे मोफत आहेत, कोणी पैसे मागितले तर देऊ नका. धन्यवाद!",
    en: "Okay, you'll get the message. Remember, government schemes are completely free; if anyone asks for money, don't pay. Thank you!",
  },
  closing: {
    hi: "ठीक है। याद रखिए, सरकारी योजनाएँ बिल्कुल मुफ़्त हैं, कोई पैसे माँगे तो मत दीजिए। धन्यवाद!",
    mr: "ठीक आहे. लक्षात ठेवा, सरकारी योजना पूर्णपणे मोफत आहेत, कोणी पैसे मागितले तर देऊ नका. धन्यवाद!",
    en: "Okay. Remember, government schemes are completely free; if anyone asks for money, don't pay. Thank you!",
  },
  noAnswer: {
    hi: "इसकी पक्की जानकारी आपको सीएससी केंद्र पर मिलेगी।",
    mr: "याची नेमकी माहिती तुम्हाला सीएससी केंद्रावर मिळेल.",
    en: "You'll get exact information about this at a CSC centre.",
  },
} as const;

export const text = (key: Exclude<keyof typeof T, "more" | "goWith">, lang: Lang) => (T[key] as Localized)[lang];
export const moreText = (n: number, lang: Lang) => T.more(n)[lang];

const firstSentence = (s: string) => s.split(/(?<=[।.])\s/)[0] ?? s;

const AND: Record<Lang, string> = { hi: " और ", mr: " आणि ", en: " and " };

function joinList(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${AND[lang]}${items.at(-1)}`;
}

/** "PM-KISAN: हर साल 6,000 रुपये..." for the given schemes, grouped by eligible / likely. */
export function composeSchemeList(
  ids: string[],
  results: Map<string, SchemeResult>,
  schemes: Map<string, Scheme>,
  lang: Lang,
): string {
  const line = (id: string) => {
    const s = schemes.get(id)!;
    return `${s.name[lang]}: ${firstSentence(s.benefitSummary[lang])}`;
  };
  const eligible = ids.filter((id) => results.get(id)?.status === "eligible");
  const likely = ids.filter((id) => results.get(id)?.status === "likely_eligible");
  const parts: string[] = [];
  if (eligible.length) parts.push(text("eligibleIntro", lang), ...eligible.map(line));
  if (likely.length) parts.push(text("likelyIntro", lang), ...likely.map(line));
  return parts.join(" ");
}

/** Full detail for one scheme: benefit, up to 3 documents, where to go, one caveat. */
export function composeDetails(scheme: Scheme, result: SchemeResult | undefined, lang: Lang): string {
  const docs = joinList(scheme.documents.slice(0, 3).map((d) => d[lang]), lang);
  const parts = [`${scheme.name[lang]}: ${scheme.benefitSummary[lang]}`, T.goWith(docs, scheme.applyAtSpoken[lang])[lang]];
  const caveat = result?.caveats[0]?.[lang];
  if (caveat) parts.push(caveat);
  return parts.join(" ");
}
