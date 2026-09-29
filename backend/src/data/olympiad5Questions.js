// LearnIQ – All India Olympiad Examination 2026 (Standard 5)
// Source: "LearnIQ_Test_Standard_5.pdf" (official PDF, 8 pages, header "TEST 2 • STANDARD 5").
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own answer key;
// the text of the keyed option was cross-checked against the key (answer-key table) for all 60 questions (0 mismatches).
// Questions contain no images/diagrams.
// NOTE: The rupee sign is printed as a black square (■) in Q53 and Q56; restored to ₹.
// NOTE: Q60 (5 rows × 8 seats = 40, minus 7 empty = 33 passengers): the paper's key says C (35), which is arithmetically wrong. The correct option B (33) is used here. To follow the paper's key instead, set correctAnswer of question 60 back to 2.

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
    "questionText": "What is the value of 6 × 1000 + 4 × 100 + 3 × 10 + 2?",
    "options": [
      "6,432",
      "6,423",
      "6,342",
      "6,324"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Which fraction is the greatest?",
    "options": [
      "3/8",
      "5/8",
      "1/2",
      "4/8"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "What is 7,845 + 3,976?",
    "options": [
      "11,721",
      "11,821",
      "11,921",
      "12,821"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "What is 9,000 − 4,786?",
    "options": [
      "4,114",
      "4,214",
      "4,314",
      "4,414"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "What is 125 × 8?",
    "options": [
      "900",
      "1,000",
      "1,100",
      "1,200"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "What is 1,728 ÷ 12?",
    "options": [
      "124",
      "134",
      "144",
      "154"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "Which decimal is equal to 3/10?",
    "options": [
      "0.03",
      "0.3",
      "3.0",
      "0.003"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "The area of a rectangle is 48 cm² and its length is 8 cm. What is its width?",
    "options": [
      "4 cm",
      "6 cm",
      "8 cm",
      "10 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "How many millilitres are there in 4 litres?",
    "options": [
      "400",
      "4,000",
      "40,000",
      "4,040"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "A fraction equivalent to 3/5 is:",
    "options": [
      "6/10",
      "5/6",
      "9/20",
      "12/25"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "What is the average of 10, 20 and 30?",
    "options": [
      "15",
      "20",
      "25",
      "30"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "Which number is a multiple of both 6 and 8?",
    "options": [
      "18",
      "24",
      "30",
      "42"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "A straight angle measures:",
    "options": [
      "45°",
      "90°",
      "180°",
      "360°"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "What is 2.75 + 1.5?",
    "options": [
      "3.25",
      "4.15",
      "4.25",
      "4.75"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "A train travels 60 km in 2 hours at a constant speed. How far will it travel in 5 hours?",
    "options": [
      "120 km",
      "150 km",
      "180 km",
      "300 km"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "Which organ pumps blood through the body?",
    "options": [
      "Lungs",
      "Heart",
      "Kidneys",
      "Stomach"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which process by plants releases water vapour through leaves?",
    "options": [
      "Digestion",
      "Transpiration",
      "Respiration",
      "Germination"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "Which is a good conductor of electricity?",
    "options": [
      "Copper",
      "Rubber",
      "Wood",
      "Plastic"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "What is the main function of roots?",
    "options": [
      "Make seeds",
      "Absorb water and anchor the plant",
      "Make flowers",
      "Produce sound"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which change is reversible?",
    "options": [
      "Burning paper",
      "Melting ice",
      "Cooking rice",
      "Rusting iron"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "Which organ helps us digest food?",
    "options": [
      "Stomach",
      "Lungs",
      "Heart",
      "Brain"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "Which of these is a communicable disease?",
    "options": [
      "Common cold",
      "Diabetes",
      "Fracture",
      "Near-sightedness"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "What is needed for germination of most seeds?",
    "options": [
      "Water, air and suitable warmth",
      "Only sunlight",
      "Only soil",
      "Only fertilizer"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "Which layer protects Earth from much of the Sun's harmful ultraviolet radiation?",
    "options": [
      "Ozone layer",
      "Soil layer",
      "Rock layer",
      "Cloud layer"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "Which force slows down a moving bicycle when brakes are applied?",
    "options": [
      "Gravity",
      "Friction",
      "Magnetism",
      "Buoyancy"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "Which animal undergoes metamorphosis?",
    "options": [
      "Butterfly",
      "Cow",
      "Dog",
      "Elephant"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "Why do we see lightning before hearing thunder?",
    "options": [
      "Light travels faster than sound",
      "Sound is stronger",
      "Thunder happens later",
      "Lightning is hotter"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "Which source of energy is non-renewable?",
    "options": [
      "Wind",
      "Sunlight",
      "Coal",
      "Flowing water"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "Which part of the blood carries oxygen to body cells?",
    "options": [
      "Red blood cells",
      "Platelets",
      "Plasma only",
      "White blood cells"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "What happens when water vapour cools?",
    "options": [
      "It condenses into liquid water",
      "It becomes fire",
      "It disappears permanently",
      "It turns directly into soil"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Choose the correct form: 'She ___ to school every day.'",
    "options": [
      "go",
      "goes",
      "going",
      "gone"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Identify the adjective: 'The tall tree fell.'",
    "options": [
      "tree",
      "fell",
      "tall",
      "the"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Choose the synonym of 'brave'.",
    "options": [
      "timid",
      "courageous",
      "lazy",
      "weak"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Choose the antonym of 'expand'.",
    "options": [
      "increase",
      "stretch",
      "contract",
      "grow"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Choose the correct preposition: 'The book is ___ the table.'",
    "options": [
      "on",
      "at",
      "to",
      "from"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Choose the correct plural of 'leaf'.",
    "options": [
      "leafs",
      "leaves",
      "leafes",
      "leavs"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Choose the correctly punctuated sentence.",
    "options": [
      "Wow what a beautiful day!",
      "Wow, what a beautiful day!",
      "Wow what a beautiful day.",
      "wow, What a beautiful day!"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Choose the correct conjunction: 'I wanted to play, ___ it was raining.'",
    "options": [
      "and",
      "but",
      "or",
      "so"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Choose the past tense of 'write'.",
    "options": [
      "writed",
      "writes",
      "wrote",
      "writing"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Choose the word that is an adverb: 'The boy ran quickly.'",
    "options": [
      "boy",
      "ran",
      "quickly",
      "the"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Logical Reasoning / GK",
    "questionText": "Find the next number: 3, 6, 12, 24, __.",
    "options": [
      "36",
      "42",
      "48",
      "54"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Logical Reasoning / GK",
    "questionText": "If BOOK is coded as CPPL, how is PEN coded?",
    "options": [
      "QFO",
      "QEN",
      "PFN",
      "RFO"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which is the smallest continent by area?",
    "options": [
      "Asia",
      "Africa",
      "Europe",
      "Australia"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Logical Reasoning / GK",
    "questionText": "How many players are there in a cricket team on the field?",
    "options": [
      "9",
      "10",
      "11",
      "12"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which instrument is used to measure temperature?",
    "options": [
      "Barometer",
      "Thermometer",
      "Compass",
      "Ammeter"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Logical Reasoning / GK",
    "questionText": "If NORTH is opposite SOUTH, what is opposite NORTH-EAST?",
    "options": [
      "South-East",
      "South-West",
      "North-West",
      "West"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which Indian state is known for the Kaziranga National Park?",
    "options": [
      "Assam",
      "Kerala",
      "Gujarat",
      "Punjab"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Logical Reasoning / GK",
    "questionText": "A cube has how many faces?",
    "options": [
      "4",
      "6",
      "8",
      "12"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Logical Reasoning / GK",
    "questionText": "If today is Wednesday, what day will it be after 10 days?",
    "options": [
      "Friday",
      "Saturday",
      "Sunday",
      "Monday"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which number does not belong: 2, 3, 5, 9, 11?",
    "options": [
      "2",
      "3",
      "9",
      "11"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "A class has 48 students. 3/8 of them are girls. How many boys are there?",
    "options": [
      "18",
      "24",
      "30",
      "36"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "A rectangular garden is 18 m long and 12 m wide. A path is made around its boundary. What is the perimeter?",
    "options": [
      "30 m",
      "48 m",
      "60 m",
      "216 m"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "A shop gives a discount of ₹25 on an item priced at ₹200. What percentage of the price is the discount?",
    "options": [
      "5%",
      "10%",
      "12.5%",
      "25%"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "A train leaves at 6:45 a.m. and travels for 2 h 35 min. When does it arrive?",
    "options": [
      "8:50 a.m.",
      "9:10 a.m.",
      "9:20 a.m.",
      "9:30 a.m."
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "A number divided by 7 gives quotient 8 and remainder 3. What is the number?",
    "options": [
      "53",
      "56",
      "59",
      "61"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "Ravi spends 2/5 of ₹500 on books and 1/10 on stationery. How much money remains?",
    "options": [
      "₹200",
      "₹250",
      "₹300",
      "₹350"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "A water container holds 12 L. It is filled using a 750 mL bottle. How many full bottles are needed?",
    "options": [
      "12",
      "14",
      "16",
      "18"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "The sum of three consecutive whole numbers is 72. What is the middle number?",
    "options": [
      "22",
      "23",
      "24",
      "25"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "A square has area 81 cm². What is its perimeter?",
    "options": [
      "18 cm",
      "27 cm",
      "36 cm",
      "40 cm"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A bus has 5 rows with 8 seats each. If 7 seats are empty, how many passengers are seated?",
    "options": [
      "31",
      "33",
      "35",
      "37"
    ],
    "correctAnswer": 1,
    "marks": 1
  }
];

module.exports = { sections, questions };
