// LearnIQ – All India Olympiad Examination 2026 (Standard 8)
// Source: "LearnIQ_All_India_Olympiad_8th_std.pdf" (official PDF, 5 pages, header "TEST 3 • CLASS 8th").
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
    "questionText": "Find the multiplicative inverse of -7/13.",
    "options": [
      "7/13",
      "-13/7",
      "13/7",
      "-7/13"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Solve for x: (x - 5)/3 = (x - 3)/5",
    "options": [
      "8",
      "7",
      "9",
      "10"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "Sum of all interior angles of a convex polygon with 7 sides is:",
    "options": [
      "720°",
      "900°",
      "1080°",
      "540°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "How many natural numbers lie between 12² and 13²?",
    "options": [
      "24",
      "25",
      "26",
      "23"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Find the square root of 7056.",
    "options": [
      "82",
      "84",
      "86",
      "74"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "Evaluate: ∛(1331) + ∛(729)",
    "options": [
      "18",
      "20",
      "22",
      "19"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "An item listed at ₹800 is sold for ₹680. Find the discount rate percentage.",
    "options": [
      "12%",
      "15%",
      "18%",
      "20%"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "If (2x + 3y)² - (2x - 3y)² = ?",
    "options": [
      "12xy",
      "24xy",
      "8x²y²",
      "0"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "Express 0.000035 in standard scientific notation.",
    "options": [
      "3.5 × 10⁻⁵",
      "3.5 × 10⁻⁴",
      "35 × 10⁻⁶",
      "3.5 × 10⁵"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "If 15 workers build a wall in 48 hours, how many workers will build it in 30 hours?",
    "options": [
      "20",
      "22",
      "24",
      "18"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "Factorize completely: 49x² - 36",
    "options": [
      "(7x - 6)²",
      "(7x + 6)(7x - 6)",
      "(7x + 6)²",
      "(49x + 1)(x - 36)"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "Volume of a cube is 512 cm³. Find its total surface area.",
    "options": [
      "384 cm²",
      "256 cm²",
      "512 cm²",
      "192 cm²"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "Simplify: (3⁻⁷ ÷ 3⁻¹⁰) × 3⁻⁵",
    "options": [
      "3²",
      "3⁻²",
      "3⁻⁸",
      "3⁵"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "The parallel sides of a trapezium are 12 cm and 20 cm, and height is 10 cm. Find its area.",
    "options": [
      "160 cm²",
      "320 cm²",
      "120 cm²",
      "200 cm²"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "Euler's formula for a 3D polyhedron is F + V - E = ?",
    "options": [
      "0",
      "1",
      "2",
      "-1"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "Which bacterial strain is used for fixing atmospheric nitrogen in leguminous plant root nodules?",
    "options": [
      "Azotobacter",
      "Rhizobium",
      "Clostridium",
      "Nitrobacter"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which synthetic fiber is known as 'Artificial Silk'?",
    "options": [
      "Nylon",
      "Polyester",
      "Rayon",
      "Acrylic"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "The purest naturally occurring form of carbon derived during destructive distillation of coal is:",
    "options": [
      "Coal Tar",
      "Coal Gas",
      "Coke",
      "Bitumen"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "Ignition temperature is defined as the:",
    "options": [
      "Highest temp",
      "Lowest temp to ignite",
      "Boiling temp",
      "Room temp"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Endemic species are those species which are:",
    "options": [
      "Found worldwide",
      "Found in a specific area",
      "Extinct",
      "Domesticated"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "Which cell organelle is known as the 'Powerhouse of the cell'?",
    "options": [
      "Golgi body",
      "ER",
      "Mitochondria",
      "Lysosome"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "External fertilization is commonly observed in which class of organisms?",
    "options": [
      "Birds/Reptiles",
      "Mammals",
      "Frogs and Fish",
      "Insects"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "Unit of force in SI system is:",
    "options": [
      "Pascal",
      "Joule",
      "Newton",
      "Watt"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "Friction caused by fluids (liquids and gases) is called:",
    "options": [
      "Static friction",
      "Drag",
      "Rolling friction",
      "Sliding friction"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "Audible frequency range for normal human ear is:",
    "options": [
      "20 Hz to 20,000 Hz",
      "Below 20 Hz",
      "Above 20,000 Hz",
      "200 Hz to 2,000 Hz"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "Process of depositing a preferred metal layer on another material using electricity is:",
    "options": [
      "Electrolysis",
      "Electroplating",
      "Electro-refining",
      "Galvanic isolation"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "Seismic waves produced during earthquakes are recorded by which instrument?",
    "options": [
      "Barometer",
      "Seismograph",
      "Electroscope",
      "Anemometer"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "Angle of incidence of a light ray on a mirror is 35°. What is the angle of reflection?",
    "options": [
      "55°",
      "35°",
      "70°",
      "90°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "Which planet in solar system is brightest and commonly called 'Morning Star'?",
    "options": [
      "Mars",
      "Venus",
      "Jupiter",
      "Mercury"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "Main gas responsible for Global Warming and enhanced greenhouse effect is:",
    "options": [
      "Sulphur Dioxide",
      "Carbon Dioxide",
      "Nitrogen Dioxide",
      "Argon"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Antonym of MANDATORY:",
    "options": [
      "Compulsory",
      "Optional",
      "Essential",
      "Required"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Convert to Indirect Speech: He said, \"Alas! I lost my wallet.\"",
    "options": [
      "He exclaimed with sorrow that he had lost his wallet.",
      "He said that he lost his wallet.",
      "He cried that my wallet was lost.",
      "He exclaimed with joy that his wallet was lost."
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Fill in blank: Each of the boys ________ awarded a medal.",
    "options": [
      "were",
      "was",
      "have been",
      "are"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Idiom meaning: \"Burn the candle at both ends\"",
    "options": [
      "Waste resources",
      "Work late and early",
      "Celebrate lavishly",
      "Cause fires"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Identify correct spelling:",
    "options": [
      "Bureaucracy",
      "Beurocracy",
      "Bureaucracyy",
      "Burocracy"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Choose correct Passive voice: \"Who wrote this book?\"",
    "options": [
      "By whom was this book written?",
      "Who was written this book by?",
      "By whom this book is written?",
      "This book was written by who?"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Identify underline part: \"She sings exceptionally well.\"",
    "options": [
      "Adjective Phrase",
      "Adverb Phrase",
      "Noun Phrase",
      "Prepositional Phrase"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "One word substitution: \"One who looks on the bright side of things.\"",
    "options": [
      "Pessimist",
      "Optimist",
      "Realist",
      "Atheist"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Choose correct modal verb: You ________ follow traffic rules strictly.",
    "options": [
      "must",
      "may",
      "might",
      "could"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Synonym of METICULOUS:",
    "options": [
      "Careless",
      "Careful and precise",
      "Rough",
      "Hasty"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Social Science / Reasoning",
    "questionText": "Who led the Santhal Rebellion of 1855 against British rule?",
    "options": [
      "Birsa Munda",
      "Sidhu and Kanhu",
      "Mangal Pandey",
      "Tantia Tope"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Social Science / Reasoning",
    "questionText": "Which sector of economy generates employment by converting raw material into finished goods?",
    "options": [
      "Primary Sector",
      "Secondary Sector",
      "Tertiary Sector",
      "Information Sector"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Social Science / Reasoning",
    "questionText": "Sustainable Development focuses on:",
    "options": [
      "Exploitation",
      "Meeting current needs for future",
      "Industry only",
      "No resource use"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Social Science / Reasoning",
    "questionText": "Who introduced the policy of 'Doctrine of Lapse' in India?",
    "options": [
      "Lord Wellesley",
      "Lord Dalhousie",
      "Lord Cornwallis",
      "Lord Canning"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Social Science / Reasoning",
    "questionText": "Number series: 2, 6, 12, 20, 30, 42, ?",
    "options": [
      "52",
      "56",
      "60",
      "64"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Social Science / Reasoning",
    "questionText": "In code language, 'SMART' = 'QKYPR'. What is 'BRAIN'?",
    "options": [
      "ZPYGL",
      "ZPYGK",
      "ZPYHM",
      "ZPXGL"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Social Science / Reasoning",
    "questionText": "If '+' means '×', '-' means '÷', '×' means '-', and '÷' means '+', evaluate: 12 + 4 - 2 ÷ 6 × 5",
    "options": [
      "25",
      "28",
      "30",
      "22"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Social Science / Reasoning",
    "questionText": "Which Article of Constitution abolishes Untouchability in India?",
    "options": [
      "Article 14",
      "Article 17",
      "Article 19",
      "Article 21"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Social Science / Reasoning",
    "questionText": "A person walks 4 km West, turns left 3 km. Shortest distance to start point?",
    "options": [
      "5 km",
      "7 km",
      "6 km",
      "1 km"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Social Science / Reasoning",
    "questionText": "Odd one out:",
    "options": [
      "Iron",
      "Copper",
      "Aluminium",
      "Brass"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "If x - 1/x = 4, find value of x² + 1/x².",
    "options": [
      "14",
      "18",
      "16",
      "20"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "Compound interest on ₹8,000 for 1.5 years at 10% per annum compounded half-yearly is:",
    "options": [
      "₹1,261",
      "₹1,200",
      "₹1,240",
      "₹1,300"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "A hollow cylindrical pipe is 21 cm long. Inner & outer radii are 3 cm and 4 cm. Volume of metal used? (π=22/7)",
    "options": [
      "462 cm³",
      "396 cm³",
      "308 cm³",
      "512 cm³"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "Reaction of non-metal oxides with water forms acidic solutions. Which oxide forms Sulphurous Acid?",
    "options": [
      "SO₃",
      "SO₂",
      "CO₂",
      "NO₂"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "Two plane mirrors inclined at 60°. How many images of an object between them are formed?",
    "options": [
      "5",
      "6",
      "4",
      "7"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "When light travels from air into glass block, what happens to its speed and direction?",
    "options": [
      "Speed increases, bends away",
      "Speed decreases, bends towards normal",
      "Speed same",
      "Speed decreases, bends away"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "Angle between clock hands at 8:30 is:",
    "options": [
      "60°",
      "75°",
      "85°",
      "90°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "Complete analogy: Penicillin : Alexander Fleming :: Smallpox Vaccine : ?",
    "options": [
      "Louis Pasteur",
      "Edward Jenner",
      "Robert Koch",
      "Jonas Salk"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "If price of sugar rises by 25%, by what percent must consumption be reduced to keep expenditure same?",
    "options": [
      "20%",
      "25%",
      "15%",
      "30%"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A train passes a 200m platform in 20 seconds at speed of 72 km/h. Length of train is:",
    "options": [
      "150 m",
      "200 m",
      "250 m",
      "300 m"
    ],
    "correctAnswer": 1,
    "marks": 1
  }
];

module.exports = { sections, questions };
