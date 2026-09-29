// LearnIQ – All India Olympiad Examination 2026 (Standard 10)
// Source: "10th Standard Olympiad Mock Test" question paper (official PDF, 8 pages).
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own
// "Correct Answer" line under every question. Questions contain no images/diagrams.
// Superscripts/subscripts that the PDF stores as separate glyphs are restored (x², cm³, XNO₃).

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
    "questionText": "What are the roots of the quadratic equation x² − 5x + 6 = 0?",
    "options": [
      "−2, −3",
      "2, 3",
      "1, 6",
      "−1, −6"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "What is the 10th term of the Arithmetic Progression (A.P.) 2, 7, 12, 17, ...?",
    "options": [
      "47",
      "52",
      "42",
      "57"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "What is the value of sin²(30°) + cos²(30°)?",
    "options": [
      "0",
      "0.5",
      "1",
      "2"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "A fair die is rolled once. What is the probability of getting a prime number?",
    "options": [
      "1/3",
      "1/6",
      "2/3",
      "1/2"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "What is the distance between the origin (0, 0) and the point (3, 4)?",
    "options": [
      "3",
      "4",
      "5",
      "7"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "What is the sum of the zeroes of the polynomial 2x² − 8x + 6?",
    "options": [
      "−4",
      "4",
      "3",
      "−3"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "What is the volume of a cylinder with a base radius of 7 cm and a height of 10 cm? (Use π = 22/7)",
    "options": [
      "1540 cm³",
      "154 cm³",
      "440 cm³",
      "3080 cm³"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "The ratio of the corresponding sides of two similar triangles is 1:2. What is the ratio of their areas?",
    "options": [
      "1:2",
      "1:4",
      "1:8",
      "1:16"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "From a point Q, the length of the tangent to a circle is 24 cm and the distance of Q from the center is 25 cm. What is the radius of the circle?",
    "options": [
      "7 cm",
      "12 cm",
      "15 cm",
      "24.5 cm"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "What is the Highest Common Factor (HCF) of 26 and 91?",
    "options": [
      "7",
      "13",
      "26",
      "91"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "What is the sum of the first 10 natural numbers?",
    "options": [
      "45",
      "50",
      "55",
      "60"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "If the length of the shadow of a tower is equal to its height, what is the sun's angle of elevation?",
    "options": [
      "30°",
      "45°",
      "60°",
      "90°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "What is the mean of the first 5 prime numbers?",
    "options": [
      "3.6",
      "5.6",
      "4.5",
      "6.5"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "What are the coordinates of the midpoint of the line segment joining (−2, 8) and (−6, −4)?",
    "options": [
      "(−4, 2)",
      "(4, −2)",
      "(−8, 4)",
      "(−2, 6)"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "The pair of linear equations kx + 2y = 5 and 3x + y = 1 has a unique solution if:",
    "options": [
      "k = 6",
      "k ≠ 6",
      "k = 0",
      "k ≠ 0"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "What is the SI unit of electrical resistivity?",
    "options": [
      "Ohm",
      "Ampere",
      "Ohm-meter",
      "Volt"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which of the following represents the correct lens formula?",
    "options": [
      "1/f = 1/v + 1/u",
      "1/f = 1/v − 1/u",
      "1/f = 1/u − 1/v",
      "f = v + u"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "Which instrument is used to measure electric current in a circuit?",
    "options": [
      "Voltmeter",
      "Galvanometer",
      "Ammeter",
      "Generator"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "Which type of lens is used to correct myopia (short-sightedness)?",
    "options": [
      "Convex lens",
      "Concave lens",
      "Cylindrical lens",
      "Bifocal lens"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which acid is naturally present in an ant sting?",
    "options": [
      "Acetic acid",
      "Citric acid",
      "Methanoic acid",
      "Lactic acid"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "The rusting of iron is an example of which type of chemical reaction?",
    "options": [
      "Reduction",
      "Oxidation",
      "Substitution",
      "Displacement"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "Which functional group is present in alcohols?",
    "options": [
      "−CHO",
      "−COOH",
      "−OH",
      ">C=O"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "Which is the only metal that exists as a liquid at room temperature?",
    "options": [
      "Sodium",
      "Iron",
      "Mercury",
      "Aluminium"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "What is the pH value of pure water at 25°C?",
    "options": [
      "0",
      "7",
      "14",
      "5.5"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "In which cellular organelle does the breakdown of pyruvate to give carbon dioxide, water, and energy take place?",
    "options": [
      "Cytoplasm",
      "Mitochondria",
      "Chloroplast",
      "Nucleus"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "Which plant hormone is responsible for the bending of a shoot towards light (phototropism)?",
    "options": [
      "Auxin",
      "Abscisic acid",
      "Cytokinin",
      "Ethylene"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "What is the primary function of xylem in plants?",
    "options": [
      "Transport of food",
      "Transport of oxygen",
      "Transport of water and minerals",
      "Transport of amino acids"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "Which gland is often referred to as the \"master gland\" of the human body?",
    "options": [
      "Thyroid",
      "Adrenal",
      "Pituitary",
      "Pancreas"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "Which part of a flower constitutes the male reproductive organ?",
    "options": [
      "Pistil",
      "Stigma",
      "Stamen",
      "Ovary"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "The ozone layer protects the Earth from which harmful radiations?",
    "options": [
      "Infrared rays",
      "X-rays",
      "Ultraviolet (UV) rays",
      "Gamma rays"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Choose the correct synonym for the word \"Abundant\".",
    "options": [
      "Scarce",
      "Plentiful",
      "Minimal",
      "Rare"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Choose the correct antonym for the word \"Transparent\".",
    "options": [
      "Clear",
      "Translucent",
      "Opaque",
      "Visible"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "What is the meaning of the idiom \"Bite the bullet\"?",
    "options": [
      "To be very hungry",
      "To face a difficult or unpleasant situation bravely",
      "To speak harshly",
      "To start a war"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Fill in the blank with the correct verb: \"Neither the principal nor the teachers _______ present in the hall.\"",
    "options": [
      "was",
      "were",
      "is",
      "has been"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Identify the word with the correct spelling.",
    "options": [
      "Accomodation",
      "Acommodation",
      "Accommodation",
      "Acomodation"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Fill in the blank with the correct preposition: \"He is exceptionally good _______ mathematics.\"",
    "options": [
      "at",
      "in",
      "with",
      "for"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Choose the correct passive voice form of the sentence: \"She writes a letter.\"",
    "options": [
      "A letter was written by her.",
      "A letter is being written by her.",
      "A letter is written by her.",
      "A letter has been written by her."
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Choose the correct indirect speech form of: He said, \"I am happy.\"",
    "options": [
      "He said that he is happy.",
      "He said that he was happy.",
      "He said that I am happy.",
      "He says that he was happy."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "What is the one-word substitute for \"A person who does not believe in the existence of God\"?",
    "options": [
      "Theist",
      "Agnostic",
      "Atheist",
      "Pacifist"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Identify the grammatical error in the following sentence: \"One of my friend is visiting me today.\"",
    "options": [
      "One of",
      "my friend",
      "is visiting",
      "me today"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Social Science / Reasoning",
    "questionText": "Who is the author of the famous book 'Hind Swaraj'?",
    "options": [
      "Jawaharlal Nehru",
      "Subhas Chandra Bose",
      "Mahatma Gandhi",
      "B.R. Ambedkar"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Social Science / Reasoning",
    "questionText": "Black soil in India is primarily considered ideal for growing which crop?",
    "options": [
      "Wheat",
      "Rice",
      "Cotton",
      "Sugarcane"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Social Science / Reasoning",
    "questionText": "Which sector is the largest employer in the Indian economy?",
    "options": [
      "Primary (Agriculture)",
      "Secondary (Manufacturing)",
      "Tertiary (Services)",
      "Quaternary (IT)"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Social Science / Reasoning",
    "questionText": "Why is power sharing considered desirable in a democracy?",
    "options": [
      "It increases the power of the majority",
      "It helps to reduce the possibility of conflict between social groups",
      "It delays decision making",
      "It divides the nation"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Social Science / Reasoning",
    "questionText": "What was the first book printed by Johannes Gutenberg?",
    "options": [
      "The Dictionary",
      "The Bible",
      "The Canterbury Tales",
      "The Republic"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Social Science / Reasoning",
    "questionText": "Find the next number in the series: 2, 6, 12, 20, ?",
    "options": [
      "24",
      "28",
      "30",
      "32"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Social Science / Reasoning",
    "questionText": "A is B's sister. C is B's mother. D is C's father. E is D's mother. How is A related to D?",
    "options": [
      "Granddaughter",
      "Daughter",
      "Aunt",
      "Niece"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Social Science / Reasoning",
    "questionText": "Ravi walks 5 km North, takes a right turn and walks 3 km, then takes another right turn and walks 5 km. How far is he from the starting point?",
    "options": [
      "5 km",
      "3 km",
      "8 km",
      "13 km"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Social Science / Reasoning",
    "questionText": "In a certain code language, if CAT is coded as 24, how will DOG be coded?",
    "options": [
      "24",
      "25",
      "26",
      "27"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Social Science / Reasoning",
    "questionText": "Choose the odd one out from the following list.",
    "options": [
      "Iron",
      "Copper",
      "Zinc",
      "Wood"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "If α and β are the zeroes of the quadratic polynomial x² − px + q, what is the value of α² + β²?",
    "options": [
      "p² + 2q",
      "p² − 2q",
      "q² − 2p",
      "p − q"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "A train travels 360 km at a uniform speed. If the speed had been 5 km/h more, it would have taken 1 hour less for the same journey. What is the original speed of the train?",
    "options": [
      "35 km/h",
      "40 km/h",
      "45 km/h",
      "50 km/h"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "Water in a canal 6 m wide and 1.5 m deep is flowing with a speed of 10 km/h. How much area will it irrigate in 30 minutes, if 8 cm of standing water is needed?",
    "options": [
      "56.25 hectares",
      "45 hectares",
      "60 hectares",
      "50.5 hectares"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "How must three resistors of 2 Ω, 3 Ω, and 6 Ω be connected to obtain a total resistance of 4 Ω?",
    "options": [
      "All three in series",
      "All three in parallel",
      "3 Ω and 6 Ω in parallel, connected in series with 2 Ω",
      "2 Ω and 3 Ω in parallel, connected in series with 6 Ω"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "A metal 'X' forms a water-soluble salt XNO₃. When aqueous sodium chloride is added to this solution, a white precipitate 'Y' is formed. What is metal X?",
    "options": [
      "Copper",
      "Iron",
      "Silver",
      "Lead"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "An object is placed 10 cm in front of a concave mirror with a radius of curvature of 15 cm. What is the magnification of the image produced?",
    "options": [
      "−1.5",
      "−2",
      "−3",
      "+3"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "A clock shows the time as 3:15. What is the exact angle between the hour hand and the minute hand?",
    "options": [
      "0°",
      "7.5°",
      "15°",
      "22.5°"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "Rearrange the following parts to form a meaningful sentence: P. the impact of | Q. on the environment | R. climate change | S. is devastating.",
    "options": [
      "PRSQ",
      "RPQS",
      "RSPQ",
      "PRQS"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "Which of the following statements regarding the French Revolution is historically incorrect?",
    "options": [
      "It began in the year 1789.",
      "It led to the establishment of an absolute monarchy in France.",
      "It introduced the ideals of Liberty, Equality, and Fraternity.",
      "The storming of the Bastille marked its beginning."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A pea plant with round yellow seeds (RrYy) is self-pollinated. What is the phenotypic ratio of the offspring obtained?",
    "options": [
      "3 : 1",
      "9 : 3 : 3 : 1",
      "1 : 2 : 1",
      "1 : 1 : 1 : 1"
    ],
    "correctAnswer": 1,
    "marks": 1
  }
];

module.exports = { sections, questions };
