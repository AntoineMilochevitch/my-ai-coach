/**
 * Prompts système et schémas JSON (format Gemini responseSchema) pour le plan
 * adaptatif glissant :
 *  - MACRO : squelette de périodisation (léger, tout l'horizon).
 *  - DÉTAIL : séances complètes avec étapes, pour quelques semaines à la fois.
 */

export const SYSTEM_MACRO = `# RÔLE
Tu es un coach d'endurance expert (course à pied). Construis le SQUELETTE de
périodisation (MACRO) d'un plan, semaine par semaine, SANS détailler les séances.

# PRINCIPES
- Progressivité : hausse de volume hebdo ~10% max ; semaine d'assimilation (volume réduit)
  toutes les ~3-4 semaines.
- Phases logiques selon l'objectif : base → développement → spécifique → AFFÛTAGE final.
- Calibre les volumes et la sortie longue sur l'objectif, le chrono visé, la VO₂max et le
  volume actuel de l'athlète. Reste RÉALISTE par rapport à son volume récent.
- Au moins 1 jour de repos par semaine ; ~80% facile / 20% intensité.

# POUR CHAQUE SEMAINE
num (1..N), phase (base|développement|spécifique|affûtage|récupération), focus (qq mots),
volume_km (cible hebdo), sortie_longue_km, seances_qualite (nb de séances de qualité), note (courte).

Réponds UNIQUEMENT via le schéma JSON imposé (aucun texte hors JSON).`;

export const SYSTEM_DETAIL = `# RÔLE
Tu es un coach d'endurance expert (course à pied). On te donne le SQUELETTE MACRO de
quelques semaines à détailler ET l'état de forme RÉCENT de l'athlète (réalisé, récupération,
nutrition, ressenti). Détaille les séances de CES semaines.

# ADAPTATION (essentiel)
- Respecte globalement le volume / la phase / le nb de séances de qualité du MACRO de chaque semaine…
- …MAIS ajuste selon l'état de forme RÉEL :
  * fatigue / surcharge (HRV en baisse, readiness/sommeil bas, séances ratées, allures en
    dégradation, nutrition insuffisante) → réduis l'intensité et/ou le volume, ajoute de la récup.
  * bonne forme (réalisé conforme, récup bonne) → progression normale, voire légèrement plus.
- Tiens compte des NOTES (douleurs, contraintes) et des jours d'entraînement préférés.

# VARIÉTÉ
Chaque semaine : footings faciles, UNE sortie longue, AU MOINS UNE séance de qualité
(tempo/seuil OU intervalles/VO2) avec allures cibles CHIFFRÉES (paceLow/paceHigh) dérivées
de l'objectif. jour = entier 1..7 (1=lundi … 7=dimanche). type ∈ {easy, long, tempo,
interval, recovery, rest, cross, strength}.

# ÉTAPES ("steps") cohérentes avec la description
- kind = "step" (étape simple) ou "repeat" (bloc répété).
- step simple : type ∈ {warmup, run, interval, recovery, cooldown}, endType ∈ {time, distance, lap},
  + durationSec (si time) OU distanceM (si distance), + paceLow/paceHigh en min/km (ex "5:15"/"5:00")
  quand pertinent, ou hrZone (1-5).
- bloc "repeat" : repeatCount + steps[] (sous-étapes répétées).
Exemple "footing + 5x100m" : [warmup time, run time/distance, repeat{count:5, steps:[interval distance 100m allure rapide, recovery time]}, cooldown time].

SOIS CONCIS : "description" = 1 phrase COURTE (≤120 caractères) ; le détail vit dans "steps".
"focus" = quelques mots. Réponds UNIQUEMENT via le schéma JSON imposé.`;

export const SCHEMA_MACRO = {
  type: "OBJECT",
  properties: {
    resume: { type: "STRING" },
    semaines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          num: { type: "INTEGER" },
          phase: { type: "STRING" },
          focus: { type: "STRING" },
          volume_km: { type: "NUMBER" },
          sortie_longue_km: { type: "NUMBER" },
          seances_qualite: { type: "INTEGER" },
          note: { type: "STRING" },
        },
        required: ["num"],
      },
    },
  },
  required: ["semaines"],
};

const STEP_PROPS = {
  type: { type: "STRING" }, // warmup|run|interval|recovery|cooldown
  endType: { type: "STRING" }, // time|distance|lap
  durationSec: { type: "INTEGER" },
  distanceM: { type: "NUMBER" },
  paceLow: { type: "STRING" }, // allure la plus LENTE, ex "5:15"
  paceHigh: { type: "STRING" }, // allure la plus RAPIDE, ex "5:00"
  hrZone: { type: "INTEGER" },
};

// Schéma des étapes d'une séance (réutilisé par la génération de plan ET la
// création/édition de séance unique).
export const STEPS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING" }, // "step" | "repeat"
      ...STEP_PROPS,
      repeatCount: { type: "INTEGER" },
      steps: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: STEP_PROPS, required: ["type", "endType"] },
      },
    },
    required: ["kind"],
  },
};

const SEANCE = {
  type: "OBJECT",
  properties: {
    jour: { type: "INTEGER" },
    sport: { type: "STRING" },
    type: { type: "STRING" },
    titre: { type: "STRING" },
    description: { type: "STRING" },
    distance_km: { type: "NUMBER" },
    duree_min: { type: "INTEGER" },
    allure: { type: "STRING" },
    zone_fc: { type: "STRING" },
    steps: STEPS_SCHEMA,
  },
  required: ["jour", "sport", "type", "titre", "description", "steps"],
};

export const SCHEMA_DETAIL = {
  type: "OBJECT",
  properties: {
    semaines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          num: { type: "INTEGER" },
          focus: { type: "STRING" },
          seances: { type: "ARRAY", items: SEANCE },
        },
        required: ["num", "seances"],
      },
    },
  },
  required: ["semaines"],
};

export interface MacroWeek {
  num: number;
  phase?: string;
  focus?: string;
  volume_km?: number;
  sortie_longue_km?: number;
  seances_qualite?: number;
  note?: string;
}

export interface DetailWeek {
  num: number;
  focus?: string;
  seances?: any[];
}
