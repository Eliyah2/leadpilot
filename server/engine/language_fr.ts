import type { Pack } from './language.js';

export const FR_PACK: Pack = {
  label: 'French',
  hooks: {
    curiosity: [
      'Presque personne ne sait ça sur {subject}.',
      'Tu ne savais probablement pas ça sur {topic}.',
      'Voilà ce que presque tout le monde comprend à tort.',
    ],
    claim: ['{claim}', 'Ce qui surprend tout le monde : {claim_lower}.', 'Retiens bien ça : {claim_lower}.'],
    question: ['Pourquoi {subject} fonctionne-t-il comme ça ?', 'Que se passe-t-il vraiment avec {topic} ?', 'Comment est-ce possible ?'],
    howto: ['Voici comment {topic} fonctionne vraiment, en moins de quarante secondes.', 'Je t\'explique {topic} avant que tu continues à scroller.'],
    contrast: ['On dirait simple. Ça ne l\'est pas.', 'Ce que tu attends est exactement le contraire de la réalité.'],
    myth: ['Tu as sûrement entendu dire que {myth}. Ce n\'est pas tout à fait ça.', 'Ceci est faux : {myth}'],
    story: ['Tout a commencé petit, et puis {claim_lower}', 'Une décision a changé toute l\'histoire de {subject}.'],
    list: ['Trois choses sur {topic} que presque tout le monde rate.', 'Voici {n} choses sur {topic} à connaître.'],
  },
  context: ['La version courte.', 'Vingt secondes et c\'est clair.', 'Tout tient dans une idée simple.'],
  transitions: [
    'Et ce n\'est pas la partie étrange.',
    'Là ça devient intéressant.',
    'Ce qui mène au point suivant.',
    'Il y a plus.',
  ],
  payoff: [
    'La prochaine fois tu sauras exactement pourquoi.',
    'Et c\'est ça qu\'il faut retenir.',
    'Petit détail, grande différence.',
  ],
  cta: [
    'Suis-moi pour un fait comme ça chaque jour.',
    'Enregistre celui-là, tu en auras besoin.',
    'Suis-moi si tu aimes comprendre le pourquoi des choses.',
  ],
  listIntro: ['En voici trois.', 'Trois choses, et la dernière est la meilleure.'],
  listConnectors: ['D\'abord', 'Ensuite', 'Puis', 'Et enfin'],
  explainerSteps: ['D\'abord,', 'Ensuite,', 'Et enfin,'],
  comparisonLead: ['D\'un côté', 'Par rapport à', 'Comparé à'],
  questionLead: ['Voici la réponse.', 'Réponse courte : oui, et voici pourquoi.'],
  mythReveal: ['La réalité est différente.', 'Voici ce que disent réellement les sources.'],
  titles: {
    curiosity: [
      'Le détail sur {topic} que presque personne ne connaît',
      'Pourquoi {topic} fonctionne ainsi',
      'Ce qu\'on ne t\'a jamais dit sur {topic}',
    ],
    educational: ['Comment {topic} fonctionne vraiment', '{topic} expliqué en 40 secondes', 'Les faits derrière {topic}'],
    search: ['{topic} expliqué', 'Qu\'est-ce que {topic} ?', '{topic} : comment ça marche'],
    short: ['{topic}, expliqué', 'La vérité sur {topic}'],
  },
  descriptionLead: ['La version courte de {topic}, sources ci-dessous.', 'Un regard rapide et factuel sur {topic}.'],
  hashtagHint: '3 à 5 hashtags précis, jamais remplis',
  onScreenHook: ['Attends', 'Fait réel', 'Expliqué'],
  onScreenPayoff: ['Retiens ça', 'Maintenant tu sais'],
};
