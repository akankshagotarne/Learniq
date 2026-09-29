// LearnIQ – All India Olympiad Examination 2026 (Standard 4)
// Source: "LearnIQ_Test_Standard_4.pdf" (official PDF, 8 pages, header "TEST 2 • STANDARD 4").
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own answer key;
// the text of the keyed option was cross-checked against the key (answer-key table) for all 60 questions (0 mismatches).
// Questions contain no images/diagrams.
// NOTE: The paper's text layer shows the rupee sign as a black square (■) in Q12 and Q59; restored to ₹ (the amounts ₹100, ₹37.50, ₹62.50 … only make sense as rupees).
// NOTE: Q60 says "Three equal-length ribbons are 45 cm, 60 cm and 75 cm" — kept exactly as printed (the lengths are obviously not equal; the answer 180 cm is unaffected).

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
    "questionText": "What is the place value of 7 in 47,326?",
    "options": [
      "7,000",
      "700",
      "70",
      "7"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Which number is the greatest?",
    "options": [
      "45,678",
      "45,768",
      "45,687",
      "45,786"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "What is 3,456 + 2,789?",
    "options": [
      "6,145",
      "6,245",
      "6,255",
      "6,345"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "What is 8,000 − 3,475?",
    "options": [
      "4,425",
      "4,525",
      "4,625",
      "5,525"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "What is 24 × 6?",
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
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "What is 936 ÷ 9?",
    "options": [
      "94",
      "104",
      "114",
      "124"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "Which fraction is equal to one-half?",
    "options": [
      "2/3",
      "3/6",
      "4/6",
      "5/8"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "A rectangle is 8 cm long and 5 cm wide. What is its perimeter?",
    "options": [
      "13 cm",
      "26 cm",
      "40 cm",
      "16 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "How many minutes are there in 3 hours?",
    "options": [
      "120",
      "150",
      "180",
      "210"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "What is 2 kg 500 g equal to in grams?",
    "options": [
      "250",
      "2,050",
      "2,500",
      "25,000"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "Which angle is smaller than a right angle?",
    "options": [
      "Acute angle",
      "Obtuse angle",
      "Straight angle",
      "Reflex angle"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "Riya has ₹100 and spends ₹37.50. How much is left?",
    "options": [
      "₹62.50",
      "₹63.50",
      "₹72.50",
      "₹73.50"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "What is the next number: 5, 10, 15, 20, __?",
    "options": [
      "22",
      "24",
      "25",
      "30"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "A shop has 7 boxes with 12 pencils in each. How many pencils are there?",
    "options": [
      "72",
      "84",
      "96",
      "108"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "Which number is divisible by both 2 and 5?",
    "options": [
      "35",
      "42",
      "55",
      "70"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "Which organ helps us breathe?",
    "options": [
      "Heart",
      "Lungs",
      "Stomach",
      "Brain"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "Which part of a plant absorbs water from the soil?",
    "options": [
      "Flower",
      "Leaf",
      "Root",
      "Fruit"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "Which of these is a source of light?",
    "options": [
      "Moon",
      "Mirror",
      "Sun",
      "Book"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "Water changes into water vapour due to ____.",
    "options": [
      "freezing",
      "evaporation",
      "melting",
      "condensation"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which animal is a herbivore?",
    "options": [
      "Lion",
      "Cow",
      "Tiger",
      "Eagle"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "Which material is attracted by a magnet?",
    "options": [
      "Wood",
      "Plastic",
      "Iron",
      "Glass"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "Which state of matter has a fixed shape?",
    "options": [
      "Solid",
      "Liquid",
      "Gas",
      "Vapour"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "What do green plants use to make food?",
    "options": [
      "Sunlight, water and carbon dioxide",
      "Only soil",
      "Only oxygen",
      "Only sunlight"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "Which force pulls objects toward Earth?",
    "options": [
      "Magnetic force",
      "Friction",
      "Gravity",
      "Muscular force"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "Which of these helps prevent soil erosion?",
    "options": [
      "Cutting trees",
      "Planting trees",
      "Removing grass",
      "Overgrazing"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "Which food is mainly a source of carbohydrates?",
    "options": [
      "Rice",
      "Butter",
      "Egg",
      "Spinach"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "Which animal lays eggs?",
    "options": [
      "Cow",
      "Dog",
      "Hen",
      "Cat"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "What happens to a shadow when an object is moved closer to a light source?",
    "options": [
      "It usually becomes larger",
      "It disappears",
      "It becomes colder",
      "It changes into light"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "Which gas do humans need for breathing?",
    "options": [
      "Carbon dioxide",
      "Oxygen",
      "Nitrogen only",
      "Hydrogen"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "Which is a renewable source of energy?",
    "options": [
      "Coal",
      "Petrol",
      "Sunlight",
      "Natural gas"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Choose the noun in the sentence: 'The puppy chased the ball.'",
    "options": [
      "chased",
      "the",
      "puppy",
      "quickly"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Choose the correct plural of 'child'.",
    "options": [
      "childs",
      "childes",
      "children",
      "childrens"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Choose the correct article: 'She ate ___ apple.'",
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
    "questionNumber": 34,
    "subject": "English",
    "questionText": "Choose the opposite of 'ancient'.",
    "options": [
      "old",
      "modern",
      "early",
      "past"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Choose the correct verb: 'The birds ___ in the sky.'",
    "options": [
      "flies",
      "fly",
      "flying",
      "flown"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Choose the synonym of 'happy'.",
    "options": [
      "sad",
      "angry",
      "joyful",
      "tired"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Identify the pronoun: 'They are playing outside.'",
    "options": [
      "playing",
      "outside",
      "They",
      "are"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Choose the correct spelling.",
    "options": [
      "Beautifull",
      "Beutiful",
      "Beautiful",
      "Beautyfull"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Which sentence is correctly punctuated?",
    "options": [
      "What is your name.",
      "What is your name?",
      "what is your name?",
      "What is your name!"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Choose the past tense of 'go'.",
    "options": [
      "goed",
      "goes",
      "went",
      "going"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Logical Reasoning / GK",
    "questionText": "Find the odd one out.",
    "options": [
      "Apple",
      "Mango",
      "Carrot",
      "Banana"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Logical Reasoning / GK",
    "questionText": "If CAT is coded as DBU, how is DOG coded using the same rule?",
    "options": [
      "EPH",
      "EOG",
      "DPH",
      "FQI"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Logical Reasoning / GK",
    "questionText": "Complete the pattern: 2, 4, 8, 16, __.",
    "options": [
      "20",
      "24",
      "30",
      "32"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which planet is known as the Red Planet?",
    "options": [
      "Earth",
      "Mars",
      "Jupiter",
      "Venus"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Logical Reasoning / GK",
    "questionText": "How many days are there in a leap year?",
    "options": [
      "365",
      "366",
      "364",
      "360"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Logical Reasoning / GK",
    "questionText": "If today is Monday, what day will it be after 3 days?",
    "options": [
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which is the largest ocean?",
    "options": [
      "Indian Ocean",
      "Atlantic Ocean",
      "Pacific Ocean",
      "Arctic Ocean"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Logical Reasoning / GK",
    "questionText": "A clock shows 3:00. What angle is formed by its hands?",
    "options": [
      "30°",
      "60°",
      "90°",
      "180°"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Logical Reasoning / GK",
    "questionText": "Which direction is opposite to East?",
    "options": [
      "North",
      "South",
      "West",
      "North-East"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Logical Reasoning / GK",
    "questionText": "How many sides does a hexagon have?",
    "options": [
      "5",
      "6",
      "7",
      "8"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "A number is greater than 4,000 and less than 5,000. Its hundreds digit is 6, tens digit is 2 and ones digit is 9. What is the number?",
    "options": [
      "4,269",
      "4,629",
      "4,692",
      "4,926"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "A farmer has 36 mangoes. He packs them equally into 4 baskets. He then adds 2 mangoes to each basket. How many mangoes are in each basket?",
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
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "A bus leaves at 8:25 a.m. and reaches at 10:05 a.m. How long is the journey?",
    "options": [
      "1 h 20 min",
      "1 h 30 min",
      "1 h 40 min",
      "1 h 50 min"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "There are 24 students. One-fourth are absent. How many students are present?",
    "options": [
      "6",
      "16",
      "18",
      "20"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "A rectangle has a perimeter of 30 cm and length 10 cm. What is its width?",
    "options": [
      "4 cm",
      "5 cm",
      "10 cm",
      "15 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "Meena reads 12 pages each day for 5 days. Her book has 75 pages. How many pages remain?",
    "options": [
      "10",
      "15",
      "20",
      "25"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "A water tank contains 5 L. Ravi uses 750 mL. How much water remains?",
    "options": [
      "4 L 150 mL",
      "4 L 250 mL",
      "4 L 350 mL",
      "4 L 750 mL"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "A pattern is 1, 4, 9, 16, 25, __. What is the next number?",
    "options": [
      "30",
      "32",
      "36",
      "40"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "A shopkeeper gives ₹20 change from ₹100. What was the cost of the item?",
    "options": [
      "₹70",
      "₹75",
      "₹80",
      "₹85"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "Three equal-length ribbons are 45 cm, 60 cm and 75 cm. What is their total length?",
    "options": [
      "160 cm",
      "170 cm",
      "180 cm",
      "190 cm"
    ],
    "correctAnswer": 2,
    "marks": 1
  }
];

module.exports = { sections, questions };
