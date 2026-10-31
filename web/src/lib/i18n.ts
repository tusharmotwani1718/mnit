import type { Lang } from "./types";

/** Site text in the three languages the agent speaks. Hindi first: it's the default for callers. */
const STRINGS = {
  appName: { hi: "योजना दर्शक", mr: "योजना दर्शक", en: "Yojana Darshak" },
  tagline: {
    hi: "जानिए आप किन सरकारी योजनाओं के हक़दार हैं",
    mr: "तुम्ही कोणत्या सरकारी योजनांसाठी पात्र आहात ते जाणून घ्या",
    en: "Find the government schemes you qualify for",
  },
  trust: {
    hi: "मुफ़्त सेवा। हम कभी आधार नंबर, बैंक खाता या ओटीपी नहीं माँगते।",
    mr: "मोफत सेवा. आम्ही कधीही आधार नंबर, बँक खाते किंवा ओटीपी मागत नाही.",
    en: "Free service. We never ask for your Aadhaar number, bank account or OTP.",
  },
  language: { hi: "भाषा", mr: "भाषा", en: "Language" },
  login: { hi: "लॉगिन", mr: "लॉगिन", en: "Log in" },
  logout: { hi: "लॉगआउट", mr: "लॉगआउट", en: "Log out" },
  profile: { hi: "मेरी प्रोफ़ाइल", mr: "माझी प्रोफाइल", en: "My profile" },
  backToChat: { hi: "← बातचीत पर लौटें", mr: "← संवादाकडे परत", en: "← Back to chat" },

  // Call card
  callTitle: { hi: "बात करना आसान लगता है? हमें कॉल करें", mr: "बोलणे सोपे वाटते? आम्हाला कॉल करा", en: "Prefer to talk? Call our agent" },
  callBody: {
    hi: "किसी भी फ़ोन से कॉल करें, हिंदी या मराठी में बात करें।",
    mr: "कोणत्याही फोनवरून कॉल करा, हिंदी किंवा मराठीत बोला.",
    en: "Call from any phone and talk in Hindi or Marathi.",
  },
  callNote: {
    hi: "डेमो लाइन (अमेरिकी नंबर)। असली सेवा में मुफ़्त भारतीय टोल-फ़्री नंबर होगा।",
    mr: "डेमो लाइन (अमेरिकन नंबर). प्रत्यक्ष सेवेत मोफत भारतीय टोल-फ्री नंबर असेल.",
    en: "Demo line (US number). The real service would use a free Indian toll-free number.",
  },
  callNumberMissing: { hi: "कॉल नंबर जल्द", mr: "कॉल नंबर लवकरच", en: "Call number coming soon" },
  callFromBrowser: { hi: "ब्राउज़र से कॉल करें", mr: "ब्राउझरवरून कॉल करा", en: "Call from browser" },
  endCall: { hi: "कॉल खत्म करें", mr: "कॉल संपवा", en: "End call" },
  connecting: { hi: "जुड़ रहे हैं…", mr: "जोडत आहे…", en: "Connecting…" },
  callFailed: { hi: "कॉल नहीं जुड़ी। फिर कोशिश करें।", mr: "कॉल जोडला नाही. पुन्हा प्रयत्न करा.", en: "Couldn't start the call. Try again." },
  inCall: { hi: "कॉल चालू है, बोलिए…", mr: "कॉल सुरू आहे, बोला…", en: "You're on the call, speak now…" },

  // Chat
  chatTitle: { hi: "सहायक से बात करें", mr: "सहाय्यकाशी बोला", en: "Chat with the assistant" },
  placeholder: { hi: "यहाँ लिखिए…", mr: "इथे लिहा…", en: "Type your message…" },
  send: { hi: "भेजें", mr: "पाठवा", en: "Send" },
  newChat: { hi: "नई बातचीत", mr: "नवीन संवाद", en: "New chat" },
  thinking: { hi: "देख रही हूँ…", mr: "पाहत आहे…", en: "Checking…" },
  chatError: {
    hi: "सहायक से संपर्क नहीं हो पाया। फिर से भेजें।",
    mr: "सहाय्यकाशी संपर्क झाला नाही. पुन्हा पाठवा.",
    en: "Couldn't reach the assistant. Please send again.",
  },
  chatEnded: { hi: "बातचीत पूरी हुई।", mr: "संवाद पूर्ण झाला.", en: "This chat has ended." },
  usingProfile: {
    hi: "आपकी सेव की गई जानकारी इस्तेमाल हो रही है, इसलिए कम सवाल पूछे जाएँगे।",
    mr: "तुमची जतन केलेली माहिती वापरली जात आहे, त्यामुळे कमी प्रश्न विचारले जातील.",
    en: "Using your saved answers, so you'll be asked fewer questions.",
  },
  loginToSave: {
    hi: "अपने जवाब सेव करने के लिए लॉगिन करें, अगली बार कम सवाल।",
    mr: "तुमची उत्तरे जतन करण्यासाठी लॉगिन करा, पुढच्या वेळी कमी प्रश्न.",
    en: "Log in to save your answers and skip questions next time.",
  },
  turnOnSaving: {
    hi: "प्रोफ़ाइल में \"जवाब सेव करें\" चालू करें ताकि अगली बार सवाल न दोहराने पड़ें।",
    mr: "प्रोफाइलमध्ये \"उत्तरे जतन करा\" सुरू करा म्हणजे पुढच्या वेळी प्रश्न पुन्हा विचारले जाणार नाहीत.",
    en: "Turn on \"Save my answers\" in your profile so you don't have to repeat them.",
  },
  answeredFrom: { hi: "स्रोत", mr: "स्रोत", en: "Answered from" },
  yes: { hi: "हाँ", mr: "हो", en: "Yes" },
  no: { hi: "नहीं", mr: "नाही", en: "No" },

  // Results
  yourSchemes: { hi: "आपके लिए योजनाएँ", mr: "तुमच्यासाठी योजना", en: "Your schemes" },
  schemesEmpty: {
    hi: "सवालों के जवाब दीजिए, आपकी योजनाएँ यहाँ दिखेंगी।",
    mr: "प्रश्नांची उत्तरे द्या, तुमच्या योजना इथे दिसतील.",
    en: "Answer a few questions and your schemes will appear here.",
  },
  stillChecking: { hi: "और जानकारी से पक्का होगा", mr: "आणखी माहितीने निश्चित होईल", en: "need more information" },
  eligible: { hi: "आप पात्र हैं", mr: "तुम्ही पात्र आहात", en: "You qualify" },
  likely: { hi: "शायद पात्र, सीएससी पर पक्का करें", mr: "कदाचित पात्र, सीएससीवर खात्री करा", en: "You may qualify; confirm at a CSC" },
  documents: { hi: "ज़रूरी कागज़", mr: "आवश्यक कागदपत्रे", en: "Documents" },
  whereToApply: { hi: "कहाँ आवेदन करें", mr: "कुठे अर्ज करावा", en: "Where to apply" },
  helpline: { hi: "हेल्पलाइन", mr: "हेल्पलाइन", en: "Helpline" },
  officialSource: { hi: "सरकारी स्रोत", mr: "सरकारी स्रोत", en: "Official source" },
  verifiedOn: { hi: "जाँच की तारीख़", mr: "तपासणी दिनांक", en: "Rules checked on" },
  note: { hi: "ध्यान दें", mr: "लक्षात घ्या", en: "Note" },
  rulesNotAi: {
    hi: "पात्रता सरकारी नियमों से तय होती है, एआई से नहीं।",
    mr: "पात्रता सरकारी नियमांवरून ठरते, एआयवरून नाही.",
    en: "Eligibility is decided by the official rules, not by AI.",
  },

  // Login
  loginTitle: { hi: "मोबाइल नंबर से लॉगिन", mr: "मोबाईल नंबरने लॉगिन", en: "Log in with your mobile number" },
  loginWhy: {
    hi: "लॉगिन करने से आपके जवाब सेव होते हैं, और इसी नंबर से कॉल करने पर भी सवाल नहीं दोहराने पड़ते।",
    mr: "लॉगिन केल्याने तुमची उत्तरे जतन होतात, आणि याच नंबरवरून कॉल केल्यावरही प्रश्न पुन्हा विचारले जात नाहीत.",
    en: "Logging in saves your answers, so you won't be asked again here or when you call from this number.",
  },
  mobileNumber: { hi: "मोबाइल नंबर", mr: "मोबाईल नंबर", en: "Mobile number" },
  sendCode: { hi: "कोड भेजें", mr: "कोड पाठवा", en: "Send code" },
  sending: { hi: "भेज रहे हैं…", mr: "पाठवत आहे…", en: "Sending…" },
  codeSentTo: { hi: "कोड भेजा गया:", mr: "कोड पाठवला:", en: "Code sent to" },
  enterCode: { hi: "6 अंकों का कोड", mr: "6 अंकी कोड", en: "6-digit code" },
  verify: { hi: "लॉगिन करें", mr: "लॉगिन करा", en: "Log in" },
  verifying: { hi: "जाँच रहे हैं…", mr: "तपासत आहे…", en: "Checking…" },
  resendIn: { hi: "दोबारा कोड भेजें", mr: "पुन्हा कोड पाठवा", en: "Resend code" },
  changeNumber: { hi: "नंबर बदलें", mr: "नंबर बदला", en: "Change number" },
  otpWarning: {
    hi: "यह कोड सिर्फ़ इस वेबसाइट पर डालें। फ़ोन पर किसी को न बताएँ।",
    mr: "हा कोड फक्त या वेबसाइटवर टाका. फोनवर कोणालाही सांगू नका.",
    en: "Enter this code only on this website. Never tell it to anyone on a call.",
  },

  // Profile
  profileTitle: { hi: "मेरी प्रोफ़ाइल", mr: "माझी प्रोफाइल", en: "My profile" },
  name: { hi: "नाम (ज़रूरी नहीं)", mr: "नाव (आवश्यक नाही)", en: "Name (optional)" },
  preferredLanguage: { hi: "पसंदीदा भाषा", mr: "आवडती भाषा", en: "Preferred language" },
  consentLabel: { hi: "मेरे जवाब सेव करें", mr: "माझी उत्तरे जतन करा", en: "Save my answers" },
  consentHelp: {
    hi: "आपकी उम्र, ज़मीन, आय, वर्ग जैसी जानकारी सेव होगी ताकि सवाल दोहराए न जाएँ। सिर्फ़ योजनाएँ जाँचने के लिए इस्तेमाल होगी। बंद करते ही सारी जानकारी मिट जाएगी।",
    mr: "तुमचे वय, जमीन, उत्पन्न, प्रवर्ग अशी माहिती जतन होईल म्हणजे प्रश्न पुन्हा विचारले जाणार नाहीत. ती फक्त योजना तपासण्यासाठी वापरली जाईल. बंद करताच सर्व माहिती पुसली जाईल.",
    en: "Your age, land, income, category and similar answers are saved so you aren't asked again. They are used only to check schemes. Turning this off deletes them.",
  },
  yourAnswers: { hi: "आपके जवाब", mr: "तुमची उत्तरे", en: "Your answers" },
  answersOff: {
    hi: "जवाब सेव करना बंद है। ऊपर चालू करें।",
    mr: "उत्तरे जतन करणे बंद आहे. वर सुरू करा.",
    en: "Saving answers is off. Turn it on above.",
  },
  notSet: { hi: "पता नहीं", mr: "माहीत नाही", en: "Not set" },
  save: { hi: "सेव करें", mr: "जतन करा", en: "Save" },
  saving: { hi: "सेव हो रहा है…", mr: "जतन होत आहे…", en: "Saving…" },
  saved: { hi: "सेव हो गया", mr: "जतन झाले", en: "Saved" },
  saveFailed: { hi: "सेव नहीं हुआ, फिर कोशिश करें", mr: "जतन झाले नाही, पुन्हा प्रयत्न करा", en: "Couldn't save, try again" },
  acres: { hi: "एकड़", mr: "एकर", en: "acres" },
  deleteProfile: { hi: "प्रोफ़ाइल हमेशा के लिए मिटाएँ", mr: "प्रोफाइल कायमची हटवा", en: "Delete my profile" },
  deleteConfirm: {
    hi: "क्या आप सच में अपनी प्रोफ़ाइल और सारे जवाब मिटाना चाहते हैं?",
    mr: "तुम्हाला खरोखर तुमची प्रोफाइल आणि सर्व उत्तरे हटवायची आहेत का?",
    en: "Delete your profile and all saved answers for good?",
  },
  loading: { hi: "लोड हो रहा है…", mr: "लोड होत आहे…", en: "Loading…" },
  needLogin: { hi: "प्रोफ़ाइल देखने के लिए लॉगिन करें।", mr: "प्रोफाइल पाहण्यासाठी लॉगिन करा.", en: "Log in to see your profile." },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export const t = (key: StringKey, lang: Lang) => STRINGS[key][lang];

/** Error codes from core / the API routes, shown to users. */
const ERRORS: Record<string, Record<Lang, string>> = {
  invalid_phone: { hi: "सही 10 अंकों का मोबाइल नंबर डालें।", mr: "योग्य 10 अंकी मोबाईल नंबर टाका.", en: "Enter a valid 10-digit mobile number." },
  too_soon: { hi: "थोड़ा रुककर दोबारा भेजें।", mr: "थोडे थांबून पुन्हा पाठवा.", en: "Please wait a moment before asking for another code." },
  too_many_codes: { hi: "बहुत सारे कोड माँगे गए। 15 मिनट बाद कोशिश करें।", mr: "खूप कोड मागितले. 15 मिनिटांनी प्रयत्न करा.", en: "Too many codes requested. Try again in 15 minutes." },
  sms_failed: { hi: "एसएमएस नहीं जा सका। थोड़ी देर बाद कोशिश करें।", mr: "एसएमएस गेला नाही. थोड्या वेळाने प्रयत्न करा.", en: "We couldn't send the SMS. Try again shortly." },
  invalid_code: { hi: "कोड गलत है।", mr: "कोड चुकीचा आहे.", en: "That code is wrong." },
  expired: { hi: "कोड की समय-सीमा खत्म हो गई, नया कोड मँगाएँ।", mr: "कोडची मुदत संपली, नवीन कोड मागवा.", en: "The code has expired; ask for a new one." },
  too_many_attempts: { hi: "बहुत बार गलत कोड डाला गया। नया कोड मँगाएँ।", mr: "खूप वेळा चुकीचा कोड टाकला. नवीन कोड मागवा.", en: "Too many wrong tries. Ask for a new code." },
  accounts_disabled: { hi: "लॉगिन अभी उपलब्ध नहीं है।", mr: "लॉगिन सध्या उपलब्ध नाही.", en: "Login isn't available right now." },
  core_unreachable: { hi: "सेवा से संपर्क नहीं हो पाया।", mr: "सेवेशी संपर्क झाला नाही.", en: "Couldn't reach the service." },
};

export const errorText = (code: string | undefined, lang: Lang) =>
  ERRORS[code ?? ""]?.[lang] ?? { hi: "कुछ गड़बड़ हो गई।", mr: "काहीतरी चूक झाली.", en: "Something went wrong." }[lang];

/** Short labels for the profile page (the agent's own questions are too long there). */
export const FACT_LABELS: Record<string, Record<Lang, string>> = {
  state: { hi: "राज्य", mr: "राज्य", en: "State" },
  residence: { hi: "गाँव या शहर", mr: "गाव की शहर", en: "Village or town" },
  age: { hi: "उम्र", mr: "वय", en: "Age" },
  gender: { hi: "लिंग", mr: "लिंग", en: "Gender" },
  annualFamilyIncome: { hi: "परिवार की सालाना आय (₹)", mr: "कुटुंबाचे वार्षिक उत्पन्न (₹)", en: "Family income per year (₹)" },
  socialCategory: { hi: "वर्ग", mr: "प्रवर्ग", en: "Category" },
  hasBankAccount: { hi: "बैंक या डाकघर खाता", mr: "बँक किंवा पोस्ट खाते", en: "Bank or post office account" },
  ownsCultivableLand: { hi: "खेती की ज़मीन है", mr: "शेतजमीन आहे", en: "Owns farmland" },
  landHectares: { hi: "ज़मीन", mr: "जमीन", en: "Land" },
  isTenantFarmer: { hi: "बटाई / किराये पर खेती", mr: "खंडाने / बटाईने शेती", en: "Tenant or sharecropper" },
  hasWaterSource: { hi: "खेत में कुआँ / बोरवेल / तालाब", mr: "शेतात विहीर / बोअरवेल / शेततळे", en: "Well, borewell or pond on the field" },
  hasConventionalPump: { hi: "खेत में बिजली का पंप", mr: "शेतात वीज पंप", en: "Electric pump on the field" },
  crop: { hi: "फ़सल", mr: "पीक", en: "Crop" },
  familyPaysIncomeTax: { hi: "परिवार में कोई इनकम टैक्स भरता है", mr: "कुटुंबात कोणी इन्कम टॅक्स भरतो", en: "Someone in the family pays income tax" },
  isIncomeTaxPayer: { hi: "मैं इनकम टैक्स भरता/भरती हूँ", mr: "मी इन्कम टॅक्स भरतो/भरते", en: "I pay income tax" },
  familyHasGovtEmployeeOrPensioner: { hi: "परिवार में सरकारी नौकरी / पेंशन", mr: "कुटुंबात सरकारी नोकरी / पेन्शन", en: "Govt job or pension in the family" },
  isGovtEmployee: { hi: "मेरी सरकारी नौकरी है/थी", mr: "माझी सरकारी नोकरी आहे/होती", en: "I have/had a government job" },
  hasOtherPensionScheme: { hi: "पहले से पेंशन / पीएफ योजना में", mr: "आधीच पेन्शन / पीएफ योजनेत", en: "Already in a pension or PF scheme" },
  hasPfOrEsic: { hi: "तनख़्वाह से पीएफ / ईएसआईसी कटता है", mr: "पगारातून पीएफ / ईएसआयसी कापतो", en: "PF or ESIC deducted from pay" },
  hasPuccaHouse: { hi: "पक्का घर है", mr: "पक्के घर आहे", en: "Has a pucca house" },
  hasLpgConnection: { hi: "गैस कनेक्शन है", mr: "गॅस जोडणी आहे", en: "Has a gas connection" },
  willingManualWork: { hi: "मज़दूरी का काम करने को तैयार", mr: "मजुरीचे काम करायला तयार", en: "Willing to do manual work" },
  isWidowOrSingleWoman: { hi: "विधवा / तलाक़शुदा / परित्यक्ता", mr: "विधवा / घटस्फोटित / परित्यक्ता", en: "Widow, divorced or abandoned" },
  studentLevel: { hi: "विद्यार्थी की कक्षा / कोर्स", mr: "विद्यार्थ्याची इयत्ता / कोर्स", en: "Student's class or course" },
  studentInGovtSchool: { hi: "विद्यार्थी सरकारी / अनुदानित स्कूल में", mr: "विद्यार्थी सरकारी / अनुदानित शाळेत", en: "Student in a govt or aided school" },
};

/** Labels for the options of multiple-choice facts; also the text sent when a quick-reply button is tapped. */
export const VALUE_LABELS: Record<string, Record<string, Record<Lang, string>>> = {
  state: {
    MH: { hi: "महाराष्ट्र", mr: "महाराष्ट्र", en: "Maharashtra" },
    OTHER: { hi: "दूसरा राज्य", mr: "दुसरे राज्य", en: "Another state" },
  },
  residence: {
    rural: { hi: "गाँव", mr: "गाव", en: "Village" },
    urban: { hi: "शहर", mr: "शहर", en: "Town or city" },
  },
  gender: {
    female: { hi: "महिला", mr: "स्त्री", en: "Woman" },
    male: { hi: "पुरुष", mr: "पुरुष", en: "Man" },
    other: { hi: "अन्य", mr: "इतर", en: "Other" },
  },
  socialCategory: {
    GEN: { hi: "जनरल / ओपन", mr: "जनरल / खुला", en: "General / Open" },
    OBC: { hi: "ओबीसी", mr: "ओबीसी", en: "OBC" },
    SC: { hi: "एससी", mr: "एससी", en: "SC" },
    ST: { hi: "एसटी", mr: "एसटी", en: "ST" },
  },
  studentLevel: {
    upto7: { hi: "पहली से सातवीं कक्षा", mr: "पहिली ते सातवी इयत्ता", en: "Class 1 to 7" },
    class8: { hi: "आठवीं कक्षा", mr: "आठवी इयत्ता", en: "Class 8" },
    class9to10: { hi: "नौवीं या दसवीं कक्षा", mr: "नववी किंवा दहावी इयत्ता", en: "Class 9 or 10" },
    class11to12: { hi: "ग्यारहवीं या बारहवीं कक्षा", mr: "अकरावी किंवा बारावी इयत्ता", en: "Class 11 or 12" },
    diploma: { hi: "डिप्लोमा / आईटीआई", mr: "डिप्लोमा / आयटीआय", en: "Diploma / ITI" },
    degree: { hi: "कॉलेज डिग्री", mr: "महाविद्यालयीन पदवी", en: "College degree" },
    postgrad: { hi: "पोस्ट-ग्रेजुएशन", mr: "पदव्युत्तर", en: "Post-graduation" },
  },
};

/** Hectares are stored; people think in acres. */
export const HECTARES_PER_ACRE = 0.404686;
