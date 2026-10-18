/**
 * Language packs: structural phrase banks used by the local content engine.
 *
 * The local engine is template-driven (no paid API required). Every phrase is
 * written to sound spoken and natural in the target language, and packs keep
 * enough variants that repeated generation does not collapse into one wording.
 *
 * Placeholders:
 *   {subject}  – concrete subject of the fact/topic ("Venus")
 *   {topic}    – topic title as generated
 *   {claim}    – short factual claim taken from the knowledge source
 *   {n}        – a number from the fact
 *   {list}     – pre-built list sentence
 */
export type Lang = 'en' | 'nl' | 'de' | 'es' | 'fr';

import { FR_PACK } from './language_fr.js';

export const LANGUAGES: { code: Lang; label: string; native: string; ttsLocale: string }[] = [
  { code: 'en', label: 'English', native: 'English', ttsLocale: 'en-US' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands', ttsLocale: 'nl-NL' },
  { code: 'de', label: 'German', native: 'Deutsch', ttsLocale: 'de-DE' },
  { code: 'es', label: 'Spanish', native: 'Español', ttsLocale: 'es-ES' },
  { code: 'fr', label: 'French', native: 'Français', ttsLocale: 'fr-FR' },
];

export type HookArchetype =
  | 'curiosity'
  | 'claim'
  | 'question'
  | 'howto'
  | 'contrast'
  | 'myth'
  | 'story'
  | 'list';

export type ScriptFormat =
  | 'facts'
  | 'story'
  | 'list'
  | 'explainer'
  | 'comparison'
  | 'question'
  | 'myth_vs_fact'
  | 'documentary';

export const FORMATS: { id: ScriptFormat; label: string; description: string }[] = [
  { id: 'facts', label: 'Facts', description: 'Two to three sharp sourced facts with a hook and payoff' },
  { id: 'story', label: 'Story', description: 'Mini narrative: setup, turn, payoff' },
  { id: 'list', label: 'List', description: 'Three-item countdown or list with a closing line' },
  { id: 'explainer', label: 'Explainer', description: 'How something works, step by step' },
  { id: 'comparison', label: 'Comparison', description: 'Two things compared, one surprising difference' },
  { id: 'question', label: 'Question', description: 'Poses a question, answers it with evidence' },
  { id: 'myth_vs_fact', label: 'Myth vs fact', description: 'Corrects a common misconception with a source' },
  { id: 'documentary', label: 'Mini documentary', description: 'Cinematic narration over a timeline' },
];

export type Pack = {
  label: string;
  hooks: Record<HookArchetype, string[]>;
  context: string[];
  transitions: string[];
  payoff: string[];
  cta: string[];
  listIntro: string[];
  listConnectors: string[];
  explainerSteps: string[];
  comparisonLead: string[];
  questionLead: string[];
  mythReveal: string[];
  titles: {
    curiosity: string[];
    educational: string[];
    search: string[];
    short: string[];
  };
  descriptionLead: string[];
  hashtagHint: string;
  onScreenHook: string[];
  onScreenPayoff: string[];
};

export const PACKS: Record<Lang, Pack> = {
  en: {
    label: 'English',
    hooks: {
      curiosity: [
        'Almost nobody knows this about {subject}.',
        'You probably didn\'t know this about {subject}.',
        'Here\'s what almost everyone gets wrong about {topic}.',
        'This one detail changes how you see {topic}.',
      ],
      claim: [
        '{claim}',
        'Here\'s the part that surprises people: {claim_lower}.',
        'Quick one: {claim_lower}.',
        'Listen to this: {claim_lower}.',
      ],
      question: [
        'Why does {subject} work like that?',
        'What actually happens when {topic}?',
        'Ever wondered why {claim_lower}?',
        'How is that even possible?',
      ],
      howto: [
        'Here\'s how {topic} actually works, in under forty seconds.',
        'Let me explain {topic} before your next scroll.',
        'Everything you need to know about {topic}, fast.',
      ],
      contrast: [
        'It looks simple. It isn\'t.',
        'What you\'d expect is the opposite of what happens.',
        'Two things that seem the same, but aren\'t.',
      ],
      myth: [
        'You\'ve probably heard {myth}. That\'s not the whole story.',
        'Let\'s check something you were taught: {myth}',
        'This common belief is wrong: {myth}',
      ],
      story: [
        'It started as a small idea, and then {claim_lower}',
        'One decision changed the whole story of {subject}.',
        'This story starts with something ordinary.',
      ],
      list: [
        'Three things about {topic} that most people miss.',
        'Here are {n} details about {topic} worth knowing.',
        'Quick list: what nobody tells you about {topic}.',
      ],
    },
    context: [
      'Here\'s the short version.',
      'Give me twenty seconds and it\'ll make sense.',
      'It comes down to one simple idea.',
      'The explanation is easier than you think.',
    ],
    transitions: [
      'And that\'s not even the strange part.',
      'Now here\'s where it gets interesting.',
      'Which leads to the next bit.',
      'Stay with me, because this connects.',
      'There\'s more.',
    ],
    payoff: [
      'So next time {topic} comes up, you\'ll know exactly why.',
      'And that\'s the part worth remembering.',
      'Which is why {topic} is stranger than it looks.',
      'Small detail, big difference.',
    ],
    cta: [
      'Follow for one like this every day.',
      'Save this one, you\'ll want it later.',
      'Follow if you like knowing the why behind things.',
      'Comment the fact that surprised you most.',
    ],
    listIntro: [
      'Here are three.',
      'Let\'s do three, fast.',
      'Three things, and the last one is the best.',
    ],
    listConnectors: ['First', 'Second', 'Third', 'And finally'],
    explainerSteps: ['First,', 'Then,', 'And finally,'],
    comparisonLead: ['On one side', 'Versus', 'Compared with'],
    questionLead: ['Here\'s the answer.', 'Short answer: yes, and here\'s why.', 'The evidence says it plainly.'],
    mythReveal: [
      'The reality is different.',
      'Here\'s what the sources actually say.',
      'The truth is simpler and stranger.',
    ],
    titles: {
      curiosity: [
        'The {topic} detail almost nobody knows',
        'Why {topic} works like this',
        'What you were never told about {topic}',
        '{topic} — the part that changes everything',
      ],
      educational: [
        'How {topic} actually works',
        '{topic} explained in 40 seconds',
        'Understanding {topic}, quickly',
        'The facts behind {topic}',
      ],
      search: ['{topic} explained', 'What is {topic}?', '{topic}: how it works and why it matters'],
      short: ['{topic}, explained', 'The truth about {topic}', '{topic} in 40s'],
    },
    descriptionLead: [
      'The short version of {topic}, with sources below.',
      'A quick, factual look at {topic}.',
      '{topic} in under a minute — here\'s what the evidence says.',
    ],
    hashtagHint: '3–5 specific hashtags, never stuffed',
    onScreenHook: ['Wait for it', 'Real fact', 'This is true', 'Explained'],
    onScreenPayoff: ['Remember that', 'Now you know', 'The takeaway'],
  },
  nl: {
    label: 'Dutch',
    hooks: {
      curiosity: ['Bijna niemand weet dit over {subject}.', 'Je wist dit waarschijnlijk niet over {subject}.', 'Dit is wat de meeste mensen fout begrijpen over {topic}.'],
      claim: ['{claim}', 'Dit is wat mensen verrast: {claim_lower}.', 'Let op: {claim_lower}.'],
      question: ['Waarom werkt {subject} zo?', 'Wat gebeurt er eigenlijk bij {topic}?', 'Had je dit verwacht?'],
      howto: ['Zo werkt {topic} echt, in minder dan veertig seconden.', 'Ik leg {topic} uit voordat je verder scrollt.'],
      contrast: ['Het lijkt simpel. Dat is het niet.', 'Wat je verwacht, is precies het omgekeerde.'],
      myth: ['Je hebt vast gehoord {myth}. Dat klopt niet helemaal.', 'Dit klopt niet: {myth}'],
      story: ['Het begon klein, en toen {claim_lower}', 'Eén beslissing veranderde het hele verhaal van {subject}.'],
      list: ['Drie dingen over {topic} die de meeste mensen missen.', 'Hier zijn {n} dingen over {topic} die je wilt weten.'],
    },
    context: ['De korte versie.', 'Twintig seconden en het klopt.', 'Het komt neer op één simpel idee.'],
    transitions: ['En dat is nog niet het vreemde deel.', 'En dan wordt het interessant.', 'Wat leidt naar het volgende stuk.', 'Er is meer.'],
    payoff: ['Dus de volgende keer weet je precies waarom.', 'En dát is wat je onthoudt.', 'Klein detail, groot verschil.'],
    cta: ['Volg voor elke dag een weetje.', 'Bewaar deze, je hebt hem later nog nodig.', 'Volg als je het waarom achter dingen leuk vindt.'],
    listIntro: ['Hier zijn drie.', 'Drie dingen, en de laatste is de beste.'],
    listConnectors: ['Eerst', 'Ten tweede', 'Als derde', 'En tot slot'],
    explainerSteps: ['Eerst,', 'Daarna,', 'En tot slot,'],
    comparisonLead: ['Aan de ene kant', 'Ten opzichte van', 'Vergeleken met'],
    questionLead: ['Hier is het antwoord.', 'Kort antwoord: ja, en dit is waarom.'],
    mythReveal: ['De werkelijkheid is anders.', 'Dit zeggen de bronnen echt.'],
    titles: {
      curiosity: ['Het detail over {topic} dat bijna niemand kent', 'Waarom {topic} zo werkt', 'Dit vertelde niemand je over {topic}'],
      educational: ['Zo werkt {topic} echt', '{topic} uitgelegd in 40 seconden', 'De feiten achter {topic}'],
      search: ['{topic} uitgelegd', 'Wat is {topic}?', '{topic}: hoe het werkt'],
      short: ['{topic}, uitgelegd', 'De waarheid over {topic}'],
    },
    descriptionLead: ['De korte versie van {topic}, met bronnen hieronder.', 'Een snelle, feitelijke blik op {topic}.'],
    hashtagHint: '3–5 specifieke hashtags, nooit volgepropt',
    onScreenHook: ['Wacht maar', 'Echt een feit', 'Uitgelegd'],
    onScreenPayoff: ['Onthoud dit', 'Nu weet je het'],
  },
  de: {
    label: 'German',
    hooks: {
      curiosity: ['Das weiß fast niemand über {subject}.', 'Das hier hättest du wahrscheinlich nicht gewusst.', 'Das missverstehen die meisten bei {topic}.'],
      claim: ['{claim}', 'Das überrascht die meisten: {claim_lower}.', 'Merke dir das: {claim_lower}.'],
      question: ['Warum funktioniert {subject} eigentlich so?', 'Was passiert da genau bei {topic}?', 'Wie kann das sein?'],
      howto: ['So funktioniert {topic} wirklich, in unter vierzig Sekunden.', 'Ich erkläre {topic}, bevor du weiter scrollst.'],
      contrast: ['Es sieht einfach aus. Ist es nicht.', 'Das Gegenteil von dem ist passiert, was du erwartest.'],
      myth: ['Du hast bestimmt gehört: {myth}. Das stimmt so nicht.', 'Das hier stimmt nicht: {myth}'],
      story: ['Es begann klein, und dann {claim_lower}', 'Eine Entscheidung änderte die ganze Geschichte von {subject}.'],
      list: ['Drei Dinge über {topic}, die die meisten übersehen.', 'Hier sind {n} Dinge über {topic}, die du kennen solltest.'],
    },
    context: ['Die kurze Version.', 'Zwanzig Sekunden, dann versteht man es.', 'Es läuft auf eine einfache Idee hinaus.'],
    transitions: ['Und das ist noch nicht der seltsame Teil.', 'Und jetzt wird es interessant.', 'Was zum nächsten Punkt führt.', 'Da ist mehr.'],
    payoff: ['Beim nächsten Mal weißt du genau, warum.', 'Und das ist der Teil, den man sich merkt.', 'Kleiner Unterschied, große Wirkung.'],
    cta: ['Folge für jeden Tag ein Fact.', 'Speichere diesen, du brauchst ihn später noch.', 'Folge, wenn du das Warum hinter Dingen magst.'],
    listIntro: ['Hier sind drei.', 'Drei Stück, und das letzte ist das Beste.'],
    listConnectors: ['Erstens', 'Zweitens', 'Drittens', 'Und zum Schluss'],
    explainerSteps: ['Erstens,', 'Dann,', 'Und zum Schluss,'],
    comparisonLead: ['Auf der einen Seite', 'Im Vergleich dazu', 'Gegenüber'],
    questionLead: ['Hier ist die Antwort.', 'Kurze Antwort: ja, und zwar so.'],
    mythReveal: ['Die Wirklichkeit sieht anders aus.', 'Das sagen die Quellen wirklich.'],
    titles: {
      curiosity: ['Das Detail über {topic}, das fast niemand kennt', 'Warum {topic} so funktioniert', 'Das hat dir niemand über {topic} erzählt'],
      educational: ['So funktioniert {topic} wirklich', '{topic} erklärt in 40 Sekunden', 'Die Fakten hinter {topic}'],
      search: ['{topic} erklärt', 'Was ist {topic}?', '{topic}: wie es funktioniert'],
      short: ['{topic}, erklärt', 'Die Wahrheit über {topic}'],
    },
    descriptionLead: ['Die kurze Version von {topic}, mit Quellen unten.', 'Ein schneller, sachlicher Blick auf {topic}.'],
    hashtagHint: '3–5 spezifische Hashtags, niemals gestopft',
    onScreenHook: ['Pass auf', 'Ist ein Fakt', 'Erklärt'],
    onScreenPayoff: ['Merke dir das', 'Jetzt weißt du es'],
  },
  es: {
    label: 'Spanish',
    hooks: {
      curiosity: ['Casi nadie sabe esto de {subject}.', 'Probablemente no sabías esto de {topic}.', 'Esto es lo que casi todos malinterpretan.'],
      claim: ['{claim}', 'Lo que sorprende es esto: {claim_lower}.', 'Atento a esto: {claim_lower}.'],
      question: ['¿Por qué {subject} funciona así?', '¿Qué pasa realmente con {topic}?', '¿Alguna vez te preguntaste por qué?'],
      howto: ['Así funciona {topic} de verdad, en cuarenta segundos.', 'Te explico {topic} antes de que sigas scrolleando.'],
      contrast: ['Parece sencillo. Y no lo es.', 'Lo que esperabas es justo lo contrario.'],
      myth: ['Seguramente oíste que {myth}. Eso no es del todo cierto.', 'Esto no es cierto: {myth}'],
      story: ['Empezó siendo pequeño, y luego {claim_lower}', 'Una decisión cambió toda la historia de {subject}.'],
      list: ['Tres cosas sobre {topic} que casi todos pasan por alto.', 'Aquí van {n} cosas sobre {topic} que conviene conocer.'],
    },
    context: ['La versión corta.', 'Veinte segundos y queda claro.', 'Se reduce a una idea sencilla.'],
    transitions: ['Y esa no es la parte rara.', 'Aquí se pone interesante.', 'Lo que lleva al siguiente punto.', 'Hay más.'],
    payoff: ['La próxima vez sabrás exactamente por qué.', 'Y eso es lo que vale la pena recordar.', 'Detalle pequeño, gran diferencia.'],
    cta: ['Sígueme para un dato así cada día.', 'Guarda este, te servirá después.', 'Sígueme si te gusta el porqué de las cosas.'],
    listIntro: ['Aquí van tres.', 'Tres cosas, y la última es la mejor.'],
    listConnectors: ['Primero', 'Segundo', 'Tercero', 'Y por último'],
    explainerSteps: ['Primero,', 'Después,', 'Y por último,'],
    comparisonLead: ['Por un lado', 'Frente a', 'Comparado con'],
    questionLead: ['Esta es la respuesta.', 'Respuesta corta: sí, y así.'],
    mythReveal: ['La realidad es otra.', 'Esto dicen las fuentes de verdad.'],
    titles: {
      curiosity: ['El detalle de {topic} que casi nadie conoce', 'Por qué {topic} funciona así', 'Lo que nadie te contó sobre {topic}'],
      educational: ['Así funciona {topic} de verdad', '{topic} explicado en 40 segundos', 'Los datos detrás de {topic}'],
      search: ['{topic} explicado', '¿Qué es {topic}?', '{topic}: cómo funciona'],
      short: ['{topic}, explicado', 'La verdad sobre {topic}'],
    },
    descriptionLead: ['La versión corta de {topic}, con fuentes abajo.', 'Una mirada rápida y factual a {topic}.'],
    hashtagHint: '3–5 hashtags concretos, sin saturar',
    onScreenHook: ['Espera', 'Dato real', 'Explicado'],
    onScreenPayoff: ['Recuérdalo', 'Ya lo sabes'],
  },
  fr: FR_PACK,
};
