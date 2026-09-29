// LearnIQ – All India Olympiad Examination 2026 (Standard 7)
// Source: "LearnIQ_All_India_Olympiad_7th_std.pdf" (official PDF, 5 pages, header "TEST 3 • CLASS 7th").
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own answer key;
// the text of the keyed option was cross-checked against the key (inline 'Correct Answer' line) for all 60 questions (0 mismatches).
// Questions contain no images/diagrams.

const sections = [
  {
    "no": 1,
    "name": "Mathematics",
    "count": 15,
    "marks": 15
  },
  {
    "no": 2,
    "name": "Science",
    "count": 15,
    "marks": 15
  },
  {
    "no": 3,
    "name": "English",
    "count": 10,
    "marks": 10
  },
  {
    "no": 4,
    "name": "Social Science / Reasoning",
    "count": 10,
    "marks": 10
  },
  {
    "no": 5,
    "name": "Achievers / HOTS",
    "count": 10,
    "marks": 10
  }
];

const questions = [
  {
    "questionNumber": 1,
    "subject": "Mathematics",
    "questionText": "Evaluate: (-18) × (-5) + (-45) ÷ 9",
    "options": [
      "85",
      "95",
      "-85",
      "-95"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Solve for x: 2x + 5 = 3x - 4",
    "options": [
      "9",
      "7",
      "1",
      "-9"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "Express 0.35 as a fraction in its simplest form.",
    "options": [
      "7/20",
      "35/100",
      "7/10",
      "3/20"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "Two complementary angles differ by 14°. Find the measure of the smaller angle.",
    "options": [
      "38°",
      "52°",
      "36°",
      "44°"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Find the mean of the first five prime numbers (2, 3, 5, 7, 11).",
    "options": [
      "5.6",
      "5.2",
      "6.0",
      "4.8"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "In a triangle ABC, ∠A = 50° and ∠B = 70°. What is the measure of the exterior angle at C?",
    "options": [
      "120°",
      "110°",
      "60°",
      "130°"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "Simplify using laws of exponents: (3² × 3⁵) ÷ 3⁴",
    "options": [
      "9",
      "27",
      "81",
      "3"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "A bicycle is bought for ₹2,500 and sold for ₹2,800. Find the gain percentage.",
    "options": [
      "10%",
      "12%",
      "15%",
      "8%"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "Find the simple interest on ₹6,000 for 3 years at 5% per annum.",
    "options": [
      "₹800",
      "₹900",
      "₹1,000",
      "₹750"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "How many lines of symmetry does a regular hexagon have?",
    "options": [
      "4",
      "5",
      "6",
      "8"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "The area of a parallelogram is 72 cm² and its base is 9 cm. Find its corresponding height.",
    "options": [
      "8 cm",
      "6 cm",
      "12 cm",
      "9 cm"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "What parameter describes the middle value of a dataset arranged in ascending order?",
    "options": [
      "Mean",
      "Median",
      "Mode",
      "Range"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "Subtract (3a - 2b) from (7a + 5b).",
    "options": [
      "4a + 7b",
      "10a + 3b",
      "4a + 3b",
      "4a - 7b"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "If ΔABC ≅ ΔPQR under the correspondence ABC ↔ PQR, then side AB corresponds to:",
    "options": [
      "PQ",
      "QR",
      "PR",
      "None of these"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "Find the circumference of a circle whose radius is 14 cm. (Use π = 22/7)",
    "options": [
      "44 cm",
      "88 cm",
      "154 cm",
      "616 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "Tiny pores present on the surface of leaves through which gas exchange occurs are called:",
    "options": [
      "Stomata",
      "Chloroplasts",
      "Xylem",
      "Guard cells"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which mode of heat transfer requires NO physical medium?",
    "options": [
      "Conduction",
      "Convection",
      "Radiation",
      "Insulation"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "The acid present in stomach juice that helps digest food and kills bacteria is:",
    "options": [
      "Sulphuric Acid",
      "Hydrochloric Acid",
      "Nitric Acid",
      "Acetic Acid"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "Rusting of iron is an example of which type of change?",
    "options": [
      "Physical Change",
      "Reversible Change",
      "Chemical Change",
      "Biological Change"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which organ in humans absorbs maximum water from undigested food material?",
    "options": [
      "Small Intestine",
      "Large Intestine",
      "Stomach",
      "Oesophagus"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "The normal body temperature of a healthy human being is:",
    "options": [
      "35°C",
      "37°C",
      "98.6°C",
      "42°C"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "Which gas is released during the process of photosynthesis?",
    "options": [
      "Carbon Dioxide",
      "Oxygen",
      "Nitrogen",
      "Hydrogen"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "Which component of blood helps in blood clotting at the site of an injury?",
    "options": [
      "Red Blood Cells",
      "White Blood Cells",
      "Platelets",
      "Plasma"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "An object moves at 15 m/s for 20 seconds. What distance does it cover?",
    "options": [
      "300 m",
      "150 m",
      "200 m",
      "450 m"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "Which device utilizes the magnetic effect of electric current to produce sound signals?",
    "options": [
      "Electric Fuse",
      "Electric Heater",
      "Electric Bell",
      "Filament Bulb"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "Vegetative propagation in potato plants occurs through which part?",
    "options": [
      "Stem (Eye)",
      "Root",
      "Leaf",
      "Flower"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "The process of deposition of a layer of zinc on iron to prevent rusting is called:",
    "options": [
      "Crystallization",
      "Galvanization",
      "Vulcanization",
      "Neutralization"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "During physical exercise, accumulation of which acid causes muscle cramps?",
    "options": [
      "Lactic Acid",
      "Citric Acid",
      "Tartaric Acid",
      "Acetic Acid"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "A spherical mirror with its reflecting surface curved inwards is called a:",
    "options": [
      "Convex mirror",
      "Concave mirror",
      "Plane mirror",
      "Cylindrical mirror"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "Upper layer of soil rich in humus and organic matter is known as:",
    "options": [
      "A-horizon (Topsoil)",
      "B-horizon",
      "C-horizon",
      "Bedrock"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Select the correct synonym for the word: AGILE",
    "options": [
      "Slow",
      "Nimble / Quick",
      "Heavy",
      "Lazy"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Choose the correct collective noun: A ________ of lions was spotted in the reserve.",
    "options": [
      "Pack",
      "Pride",
      "Herd",
      "Flock"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Complete with suitable pronoun: The dog wagged ________ tail happily.",
    "options": [
      "it's",
      "its",
      "their",
      "his"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Identify the superlative degree of 'Far':",
    "options": [
      "Farther",
      "Farthest",
      "Most Far",
      "More Far"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Choose the correctly spelled word:",
    "options": [
      "Necessary",
      "Necesary",
      "Neccessary",
      "Necessaryy"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Change to passive voice: \"The guard opened the gate.\"",
    "options": [
      "The gate is opened by the guard.",
      "The gate was opened by the guard.",
      "The gate has been opened by the guard.",
      "The gate opened the guard."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Meaning of the idiom: \"A piece of cake\"",
    "options": [
      "Very sweet",
      "Very easy task",
      "Expensive item",
      "Difficult challenge"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Fill in with preposition: She is fond ________ classical music.",
    "options": [
      "with",
      "of",
      "about",
      "in"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Identify the conjunction: \"He worked hard, yet he failed.\"",
    "options": [
      "worked",
      "hard",
      "yet",
      "failed"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Choose antonym for: ANCIENT",
    "options": [
      "Old",
      "Modern",
      "Historic",
      "Past"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Social Science / Reasoning",
    "questionText": "Who built the famous Qutub Minar in Delhi (started by Qutb-ud-din Aibak & completed by)?",
    "options": [
      "Alauddin Khalji",
      "Iltutmish",
      "Balban",
      "Razia Sultana"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Social Science / Reasoning",
    "questionText": "Which key document guarantees equal rights to all citizens in democratic India?",
    "options": [
      "Constitution of India",
      "Preamble only",
      "Penal Code",
      "Civil Code"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Social Science / Reasoning",
    "questionText": "The narrow zone where air, water, and land interact to support life is called:",
    "options": [
      "Atmosphere",
      "Hydrosphere",
      "Biosphere",
      "Lithosphere"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Social Science / Reasoning",
    "questionText": "Who was the Chola ruler who built the famous Brihadeshwara Temple at Thanjavur?",
    "options": [
      "Rajaraja I",
      "Rajendra I",
      "Karikala",
      "Parantaka I"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Social Science / Reasoning",
    "questionText": "Complete sequence: 4, 8, 16, 32, 64, ?",
    "options": [
      "96",
      "128",
      "120",
      "256"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Social Science / Reasoning",
    "questionText": "If CAT = 24 and DOG = 26, then PIG = ? (Sum of alphabetical positions)",
    "options": [
      "32",
      "34",
      "36",
      "30"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Social Science / Reasoning",
    "questionText": "If A is B's sister, B is C's mother, then how is A related to C?",
    "options": [
      "Sister",
      "Aunt",
      "Mother",
      "Grandmother"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Social Science / Reasoning",
    "questionText": "Which surface winds blow continuously in a particular direction throughout the year?",
    "options": [
      "Local Winds",
      "Seasonal Winds",
      "Permanent / Trade Winds",
      "Cyclones"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Social Science / Reasoning",
    "questionText": "A boy walks 10m East, turns left and walks 10m. What direction is he relative to start?",
    "options": [
      "North-East",
      "North-West",
      "South-East",
      "North"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Social Science / Reasoning",
    "questionText": "Choose the odd one out:",
    "options": [
      "Triangle",
      "Square",
      "Circle",
      "Rectangle"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "Simplify: [(-2)³ × (-3)²] ÷ (-6)",
    "options": [
      "12",
      "-12",
      "24",
      "-24"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "A sum of money amounts to ₹3,600 in 2 years and ₹4,200 in 4 years at simple interest. Find the principal sum.",
    "options": [
      "₹3,000",
      "₹2,800",
      "₹3,200",
      "₹2,500"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "A wire is in the form of a square of side 22 cm. If re-bent into a circle, find the radius.",
    "options": [
      "7 cm",
      "14 cm",
      "21 cm",
      "10.5 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "Why does a copper vessel develop a green coating when exposed to moist air for a long time?",
    "options": [
      "Formation of Copper Sulphate",
      "Formation of Basic Copper Carbonate",
      "Formation of Copper Oxide only",
      "Formation of Copper Nitrate"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "An object is placed 15 cm in front of a plane mirror. If moved 5 cm towards mirror, distance from image is:",
    "options": [
      "10 cm",
      "20 cm",
      "15 cm",
      "25 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "What happens to the breathing rate in humans when we perform heavy exercise?",
    "options": [
      "Decreases",
      "Increases up to 25 times/min",
      "Remains unchanged",
      "Stops temporarily"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "Find angle between clock hands at 4:00.",
    "options": [
      "90°",
      "120°",
      "150°",
      "100°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "Complete analogy: Stomata : Transpiration :: Xylem : ?",
    "options": [
      "Food transport",
      "Water transport",
      "Photosynthesis",
      "Respiration"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "Cost of 12 pens is equal to selling price of 10 pens. Find profit percent.",
    "options": [
      "15%",
      "20%",
      "25%",
      "10%"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A, B, C can do a job in 10, 12, 15 days respectively. Together they will complete it in:",
    "options": [
      "4 days",
      "5 days",
      "6 days",
      "3 days"
    ],
    "correctAnswer": 0,
    "marks": 1
  }
];

module.exports = { sections, questions };
