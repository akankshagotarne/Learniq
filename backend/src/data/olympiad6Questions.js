// LearnIQ – All India Olympiad Examination 2026 (Standard 6)
// Source: "LearnIQ_Test_Standard_6.pdf" (official PDF, 8 pages, header "TEST 2 • STANDARD 6").
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own answer key;
// the text of the keyed option was cross-checked against the key (answer-key table) for all 60 questions (0 mismatches).
// Questions contain no images/diagrams.
// NOTE: The rupee sign is printed as a black square (■) in Q15 and Q56; restored to ₹.
// NOTE: Q1 is printed as "3■" (the exponent glyph is missing in the PDF). The paper's key is D (81) and the only power of 3 that gives 81 is 3⁴, so it is restored as "3⁴".
// NOTE: Q42: "EFM IJ" (stray space) corrected to "EFMIJ".

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
    "name": "Logical Reasoning / GK",
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
    "questionText": "What is the value of 3⁴?",
    "options": [
      "12",
      "27",
      "64",
      "81"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Which integer is greater?",
    "options": [
      "−8",
      "−5",
      "−10",
      "−12"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "What is the HCF of 24 and 36?",
    "options": [
      "6",
      "8",
      "12",
      "18"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "What is the LCM of 8 and 12?",
    "options": [
      "16",
      "20",
      "24",
      "48"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Simplify: 3/4 + 1/8.",
    "options": [
      "4/12",
      "5/8",
      "7/8",
      "1"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "What is 2.5 × 0.4?",
    "options": [
      "0.1",
      "1",
      "10",
      "0.01"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "If x + 7 = 19, what is x?",
    "options": [
      "10",
      "11",
      "12",
      "13"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "The ratio 12:18 in simplest form is:",
    "options": [
      "2:3",
      "3:2",
      "4:5",
      "6:9"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "What is the perimeter of a square with side 7.5 cm?",
    "options": [
      "15 cm",
      "22.5 cm",
      "30 cm",
      "56.25 cm"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "What is the area of a triangle with base 10 cm and height 6 cm?",
    "options": [
      "16 cm²",
      "30 cm²",
      "60 cm²",
      "120 cm²"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "An angle measuring 125° is:",
    "options": [
      "Acute",
      "Right",
      "Obtuse",
      "Straight"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "What is the mean of 6, 8, 10, 12 and 14?",
    "options": [
      "8",
      "9",
      "10",
      "12"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "Convert 3/5 into a percentage.",
    "options": [
      "30%",
      "50%",
      "60%",
      "75%"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "A car travels 150 km in 3 hours. What is its average speed?",
    "options": [
      "30 km/h",
      "40 km/h",
      "50 km/h",
      "60 km/h"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "If 5 pens cost ₹60, what is the cost of 8 pens at the same rate?",
    "options": [
      "₹84",
      "₹90",
      "₹96",
      "₹100"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "Which part of the cell controls most of its activities?",
    "options": [
      "Cell wall",
      "Nucleus",
      "Cytoplasm",
      "Vacuole"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which nutrient is mainly needed for growth and repair of body tissues?",
    "options": [
      "Proteins",
      "Carbohydrates",
      "Fats",
      "Minerals"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "Which method separates sand from water?",
    "options": [
      "Filtration",
      "Evaporation only",
      "Magnetic separation",
      "Churning"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "Which of the following is a physical change?",
    "options": [
      "Melting wax",
      "Burning wood",
      "Rusting iron",
      "Cooking food"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which gas is released by green plants during photosynthesis?",
    "options": [
      "Carbon dioxide",
      "Oxygen",
      "Nitrogen",
      "Hydrogen"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "What is the SI unit commonly used for measuring length?",
    "options": [
      "Kilogram",
      "Second",
      "Metre",
      "Litre"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "Which component of a circuit provides electrical energy?",
    "options": [
      "Switch",
      "Cell/Battery",
      "Bulb",
      "Wire"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "Why does a metal spoon feel colder than a wooden spoon in the same room?",
    "options": [
      "Metal conducts heat away from the hand faster",
      "Wood has no temperature",
      "Metal contains ice",
      "Wood produces heat"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "Which type of joint allows movement in the shoulder in many directions?",
    "options": [
      "Fixed joint",
      "Ball-and-socket joint",
      "Hinge joint",
      "Pivot joint"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "Which organism is a decomposer?",
    "options": [
      "Grass",
      "Mushroom",
      "Deer",
      "Tiger"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "What is the process by which plants lose excess water through leaves?",
    "options": [
      "Transpiration",
      "Respiration",
      "Digestion",
      "Germination"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "Which planet has prominent rings visible around it?",
    "options": [
      "Mercury",
      "Mars",
      "Saturn",
      "Earth"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "What causes day and night on Earth?",
    "options": [
      "Earth's rotation on its axis",
      "Earth's revolution around the Sun",
      "Moon's rotation",
      "Cloud movement"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "Which substance is acidic?",
    "options": [
      "Lemon juice",
      "Soap solution",
      "Baking soda solution",
      "Lime water"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "Which adaptation helps a camel survive in a desert?",
    "options": [
      "Wide webbed feet for swimming",
      "Ability to store fat in its hump",
      "Thick layer of blubber",
      "Gills"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Choose the correct sentence.",
    "options": [
      "He don't like tea.",
      "He doesn't like tea.",
      "He doesn't likes tea.",
      "He not like tea."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Identify the verb: 'The children played football.'",
    "options": [
      "children",
      "played",
      "football",
      "the"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Choose the synonym of 'rapid'.",
    "options": [
      "slow",
      "quick",
      "weak",
      "late"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Choose the antonym of 'scarce'.",
    "options": [
      "rare",
      "limited",
      "abundant",
      "small"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Choose the correct article: 'He is ___ honest man.'",
    "options": [
      "a",
      "an",
      "the",
      "no article"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Choose the correct preposition: 'She has lived here ___ 2020.'",
    "options": [
      "for",
      "since",
      "from",
      "at"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Choose the plural of 'mouse'.",
    "options": [
      "mouses",
      "mouse",
      "mice",
      "meese"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Identify the adverb: 'The scientist carefully recorded the result.'",
    "options": [
      "scientist",
      "carefully",
      "recorded",
      "result"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Choose the correct reported form: Ravi said, 'I am tired.'",
    "options": [
      "Ravi said that I am tired.",
      "Ravi said that he was tired.",
      "Ravi says he was tired.",
      "Ravi said that he is tired."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Choose the correctly punctuated sentence.",
    "options": [
      "Although it was raining we went outside.",
      "Although it was raining, we went outside.",
      "Although, it was raining we went outside.",
      "although it was raining, We went outside."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Logical Reasoning / GK",
    "questionText": "Find the next number: 1, 4, 9, 16, 25, __.",
    "options": [
      "30",
      "36",
      "40",
      "49"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Logical Reasoning / GK",
    "questionText": "If DELHI is coded as EFMIJ by shifting each letter one step forward, what is the code for INDIA?",
    "options": [
      "JOEJB",
      "JOEIA",
      "JNEJB",
      "JPEJB"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which line divides Earth into Northern and Southern Hemispheres?",
    "options": [
      "Prime Meridian",
      "Equator",
      "Tropic of Cancer",
      "Arctic Circle"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which is the largest planet in the Solar System?",
    "options": [
      "Earth",
      "Saturn",
      "Jupiter",
      "Neptune"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Logical Reasoning / GK",
    "questionText": "A clock gains 5 minutes every hour. How many minutes will it gain in 6 hours?",
    "options": [
      "10",
      "20",
      "30",
      "35"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Logical Reasoning / GK",
    "questionText": "If all roses are flowers and some flowers fade quickly, which statement must be true?",
    "options": [
      "All roses fade quickly",
      "Some flowers may fade quickly",
      "No roses are flowers",
      "All flowers are roses"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which Indian constitutional body conducts elections in India?",
    "options": [
      "Election Commission of India",
      "Supreme Court",
      "RBI",
      "NITI Aayog"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which is the longest river in India by length within India?",
    "options": [
      "Ganga",
      "Godavari",
      "Narmada",
      "Yamuna"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Logical Reasoning / GK",
    "questionText": "A cube is painted on all faces and cut into 27 equal small cubes. How many small cubes have paint on three faces?",
    "options": [
      "4",
      "6",
      "8",
      "12"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which number should replace ?: 7, 14, 28, ?, 112",
    "options": [
      "42",
      "48",
      "56",
      "64"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "A number is increased by 20% and becomes 360. What was the original number?",
    "options": [
      "280",
      "300",
      "320",
      "340"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "A rectangular field is 25 m long and 16 m wide. A square plot of side 8 m is removed from it. What area remains?",
    "options": [
      "304 m²",
      "336 m²",
      "368 m²",
      "400 m²"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "The ratio of boys to girls in a class is 3:2. If there are 25 students, how many are girls?",
    "options": [
      "8",
      "10",
      "12",
      "15"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "A tank is 3/5 full. After adding 24 L, it becomes completely full. What is the capacity of the tank?",
    "options": [
      "40 L",
      "50 L",
      "60 L",
      "75 L"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "The average of four numbers is 18. Three numbers are 12, 16 and 20. What is the fourth number?",
    "options": [
      "20",
      "22",
      "24",
      "26"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "A shopkeeper buys an article for ₹800 and sells it for ₹920. What is the profit percentage?",
    "options": [
      "10%",
      "12%",
      "15%",
      "20%"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "A cyclist covers 18 km in 45 minutes. At the same speed, how far will the cyclist travel in 2 hours?",
    "options": [
      "36 km",
      "42 km",
      "48 km",
      "54 km"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "Two numbers have HCF 6 and LCM 72. If one number is 18, what is the other number?",
    "options": [
      "12",
      "18",
      "24",
      "36"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "A rectangular box measures 10 cm × 6 cm × 4 cm. What is its volume?",
    "options": [
      "120 cm³",
      "180 cm³",
      "240 cm³",
      "300 cm³"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A sequence starts 2, 5, 11, 23, 47. Each term is obtained by multiplying the previous term by 2 and adding 1. What is the next term?",
    "options": [
      "94",
      "95",
      "96",
      "97"
    ],
    "correctAnswer": 1,
    "marks": 1
  }
];

module.exports = { sections, questions };
