// LearnIQ – All India Olympiad Examination 2026 (Standard 2)
// Source: "CLASS 2 2026 NEW.pdf".
// 40 questions, 40 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own "Answer:" line;
// the text of the keyed option was cross-checked against the answer text for all 40 questions (0 mismatches).
// The optional explanation is the parenthesised note printed after the answer in the paper (shown only in the post-submission review).
// Questions contain no images/diagrams.
// NOTE: English Q6 (paper) prints option D as "(E)" — treated as D (4th option).
// NOTE (PAPER ERROR, kept as printed): Q24 (English "Choose the correct spelling") prints options A and B both as "Beautiful"; the paper keys B. Options C ("Beautifull") and D ("Beeutiful") are the wrong spellings.

const sections = [
  {
    "no": 1,
    "name": "Mathematics",
    "count": 10,
    "marks": 10
  },
  {
    "no": 2,
    "name": "Science / EVS",
    "count": 10,
    "marks": 10
  },
  {
    "no": 3,
    "name": "English",
    "count": 10,
    "marks": 10
  },
  {
    "no": 4,
    "name": "Logical Reasoning",
    "count": 5,
    "marks": 5
  },
  {
    "no": 5,
    "name": "Achievers / HOTS",
    "count": 5,
    "marks": 5
  }
];

const questions = [
  {
    "questionNumber": 1,
    "subject": "Mathematics",
    "questionText": "What is the place value of the digit 5 in the number 258?",
    "options": [
      "5",
      "50",
      "500",
      "25"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "There are 45 boys and 32 girls in a school assembly. How many students are there in total?",
    "options": [
      "75",
      "76",
      "77",
      "78"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "45 + 32 = 77"
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "How many months in a year have exactly 31 days?",
    "options": [
      "5",
      "6",
      "7",
      "8"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "January, March, May, July, August, October, December"
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "A spider has 8 legs. How many legs do 4 spiders have in total?",
    "options": [
      "12",
      "24",
      "32",
      "36"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "4 x 8 = 32"
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Rohan has two ₹50 notes and one ₹20 note. How much money does he have in total?",
    "options": [
      "₹70",
      "₹100",
      "₹120",
      "₹150"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "50 + 50 + 20 = 120"
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "Which of the following solid shapes has completely curved surfaces and NO corners (vertices)?",
    "options": [
      "Cube",
      "Cone",
      "Cylinder",
      "Sphere"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "If you cut a birthday cake into 4 equal pieces and your friends eat 3 pieces, what fraction of the cake is left?",
    "options": [
      "1/4",
      "2/4",
      "¾",
      "4/4"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "4 pieces total - 3 pieces eaten = 1 piece left out of 4"
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "A fruit seller had 90 apples. He sold 45 of them in the morning. How many apples are left with him?",
    "options": [
      "40",
      "45",
      "50",
      "55"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "90 - 45 = 45"
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "What number comes next in the given pattern: 15, 20, 25, 30, ___?",
    "options": [
      "31",
      "32",
      "35",
      "40"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "Counting forward by 5s"
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "Which is the longest measure of time among the following?",
    "options": [
      "1 Hour",
      "1 Day",
      "1 Week",
      "1 Month"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Science / EVS",
    "questionText": "Which part of the plant is known as its \"kitchen\" because it makes food for the plant?",
    "options": [
      "Root",
      "Stem",
      "Leaf",
      "Flower"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Science / EVS",
    "questionText": "Which animal gives us wool to make sweaters and winter clothes?",
    "options": [
      "Cow",
      "Dog",
      "Sheep",
      "Horse"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Science / EVS",
    "questionText": "Which internal organ helps us to breathe?",
    "options": [
      "Brain",
      "Heart",
      "Lungs",
      "Stomach"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Science / EVS",
    "questionText": "What do we call the solid form of water?",
    "options": [
      "Steam",
      "Ice",
      "Water vapor",
      "Rain"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Science / EVS",
    "questionText": "Fast-moving air is called _________.",
    "options": [
      "Wind",
      "Cloud",
      "Rain",
      "Smoke"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science / EVS",
    "questionText": "Which of the following is a wild animal that lives in the jungle?",
    "options": [
      "Goat",
      "Tiger",
      "Cow",
      "Sheep"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science / EVS",
    "questionText": "In which direction does the Sun rise every morning?",
    "options": [
      "North",
      "South",
      "East",
      "West"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science / EVS",
    "questionText": "During which season do we prefer to wear light cotton clothes?",
    "options": [
      "Winter",
      "Monsoon",
      "Spring",
      "Summer"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science / EVS",
    "questionText": "Which of these vehicles travels on water?",
    "options": [
      "Train",
      "Ship",
      "Helicopter",
      "Bus"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science / EVS",
    "questionText": "We eat the roots of which of the following plants?",
    "options": [
      "Apple",
      "Spinach",
      "Carrot",
      "Tomato"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "English",
    "questionText": "What is the correct plural form of the word \"Child\"?",
    "options": [
      "Childs",
      "Childrens",
      "Children",
      "Childes"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "English",
    "questionText": "What is the exact opposite of the word \"HEAVY\"?",
    "options": [
      "Big",
      "Light",
      "Soft",
      "Tall"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "English",
    "questionText": "Fill in the blank with the correct pronoun: \"Riya is my best friend. _____ is a good singer.\"",
    "options": [
      "He",
      "It",
      "She",
      "They"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "English",
    "questionText": "Choose the correct spelling from the options below:",
    "options": [
      "Beautiful",
      "Beautiful",
      "Beautifull",
      "Beeutiful"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "English",
    "questionText": "Fill in the blank with the correct word: \"The clock is hanging _____ the wall.\"",
    "options": [
      "in",
      "on",
      "under",
      "at"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "English",
    "questionText": "Identify the action word (verb) in the following sentence: \"The little puppy barks loudly.\"",
    "options": [
      "little",
      "puppy",
      "barks",
      "loudly"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "English",
    "questionText": "Which word has the SAME meaning as the word \"START\"?",
    "options": [
      "End",
      "Stop",
      "Begin",
      "Finish"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "English",
    "questionText": "What is the feminine (female) gender of the word \"Tiger\"?",
    "options": [
      "Tigeress",
      "Tigress",
      "Tiger",
      "Cub"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "English",
    "questionText": "Identify the describing word (adjective) in the sentence: \"I ride a shiny bicycle.\"",
    "options": [
      "I",
      "ride",
      "shiny",
      "bicycle"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "English",
    "questionText": "Fill in the blank with the correct article: \"My mother gave me _____ orange in my lunchbox.\"",
    "options": [
      "a",
      "an",
      "The",
      "no article"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "Logical Reasoning",
    "questionText": "What comes next in the given letter sequence: B, D, F, H, ___?",
    "options": [
      "I",
      "J",
      "K",
      "L"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Skipping one letter each time: B, c, D, e, F, g, H, i, J"
  },
  {
    "questionNumber": 32,
    "subject": "Logical Reasoning",
    "questionText": "Find the odd one out from the following modes of transport:",
    "options": [
      "Bus",
      "Car",
      "Train",
      "Aeroplane"
    ],
    "correctAnswer": 3,
    "marks": 1,
    "explanation": "It travels in the air, while the others travel on land"
  },
  {
    "questionNumber": 33,
    "subject": "Logical Reasoning",
    "questionText": "If A = 1, B = 2, and C = 3, which letter represents the answer to 2 + 2?",
    "options": [
      "C",
      "D",
      "E",
      "F"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "2 + 2 = 4, and the 4th letter of the alphabet is D"
  },
  {
    "questionNumber": 34,
    "subject": "Logical Reasoning",
    "questionText": "In a line of 5 children, Amit is standing exactly in the middle. What is his position from the front?",
    "options": [
      "2nd",
      "3rd",
      "4th",
      "5th"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "He has 2 children in front of him and 2 behind him"
  },
  {
    "questionNumber": 35,
    "subject": "Logical Reasoning",
    "questionText": "If today is Monday, what day will it be exactly after 3 days?",
    "options": [
      "Wednesday",
      "Thursday",
      "Friday",
      "Tuesday"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Tuesday is 1 day, Wednesday is 2 days, Thursday is 3 days after"
  },
  {
    "questionNumber": 36,
    "subject": "Achievers / HOTS",
    "questionText": "If the day before yesterday was Thursday, what day will tomorrow be?",
    "options": [
      "Saturday",
      "Sunday",
      "Monday",
      "Friday"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "If day before yesterday was Thursday, yesterday was Friday, today is Saturday. So, tomorrow is Sunday"
  },
  {
    "questionNumber": 37,
    "subject": "Achievers / HOTS",
    "questionText": "A watermelon weighs as much as 4 apples. An apple weighs as much as 3 lemons. How many lemons will weigh exactly the same as 1 watermelon?",
    "options": [
      "7",
      "10",
      "12",
      "8"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "1 Apple = 3 Lemons. So, 4 Apples = 4 x 3 = 12 Lemons"
  },
  {
    "questionNumber": 38,
    "subject": "Achievers / HOTS",
    "questionText": "A pencil costs ₹5 and an eraser costs ₹3. Rahul buys 2 pencils and 3 erasers. He gives a ₹50 note to the shopkeeper. How much change will he get back?",
    "options": [
      "₹31",
      "₹19",
      "₹21",
      "₹41"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "Cost of 2 pencils = ₹10. Cost of 3 erasers = ₹9. Total spent = ₹19. Change = 50 - 19 = ₹31"
  },
  {
    "questionNumber": 39,
    "subject": "Achievers / HOTS",
    "questionText": "In a line of children waiting for a swing, Maya is standing 4th from the front and 5th from the back. How many children are there in the line in total?",
    "options": [
      "9",
      "10",
      "8",
      "7"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "There are 3 kids in front of her, and 4 kids behind her. 3 + 1 (Maya) + 4 = 8 kids"
  },
  {
    "questionNumber": 40,
    "subject": "Achievers / HOTS",
    "questionText": "A whole pizza is cut into 8 equal slices. Ram eats half of the entire pizza. Shyam eats 1 slice. How many slices are left?",
    "options": [
      "2",
      "3",
      "4",
      "5"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Half of 8 slices = 4 slices. Ram ate 4, Shyam ate 1. Total eaten = 5. Left = 8 - 5 = 3"
  }
];

module.exports = { sections, questions };
