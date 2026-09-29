// LearnIQ – All India Olympiad Examination 2026 (Standard 1)
// Source: "CLASS 1 2026.pdf".
// 40 questions, 40 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own "Answer:" line;
// the text of the keyed option was cross-checked against the answer text for all 40 questions (0 mismatches).
// The optional explanation is the parenthesised note printed after the answer in the paper (shown only in the post-submission review).
// Questions contain no images/diagrams.
// NOTE: Q1 explanation and Q2 text were run together by the PDF text layer; restored to the printed wording.

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
    "questionText": "How many wheels are there on 2 normal cars?",
    "options": [
      "4",
      "6",
      "8",
      "10"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "4 wheels per car x 2"
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "What is the sum of 7 and 5?",
    "options": [
      "11",
      "12",
      "13",
      "14"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "Rahul has 10 chocolates. He eats 3 of them. How many chocolates are left?",
    "options": [
      "5",
      "6",
      "7",
      "8"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "Which geometric shape has exactly 3 sides and 3 corners?",
    "options": [
      "Square",
      "Circle",
      "Triangle",
      "Rectangle"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Which of the following numbers is the smallest?",
    "options": [
      "12",
      "8",
      "15",
      "9"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "What comes next in the given number pattern: 2, 4, 6, 8, ___?",
    "options": [
      "9",
      "10",
      "11",
      "12"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Skip counting by 2"
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "You have one ₹10 coin and one ₹5 coin in your piggy bank. How much money do you have in total?",
    "options": [
      "₹10",
      "₹15",
      "₹20",
      "₹5"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "Which day of the week comes exactly after Tuesday?",
    "options": [
      "Monday",
      "Thursday",
      "Wednesday",
      "Friday"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "Which of the following objects is generally the longest?",
    "options": [
      "A pencil",
      "An eraser",
      "A cricket bat",
      "A toothbrush"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "In the word \"APPLE\", what is the position of the letter 'L' from the left?",
    "options": [
      "Second",
      "Third",
      "Fourth",
      "Fifth"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Science / EVS",
    "questionText": "Which sense organ helps us taste an ice cream?",
    "options": [
      "Eyes",
      "Nose",
      "Tongue",
      "Ears"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Science / EVS",
    "questionText": "What is the baby of a cow called?",
    "options": [
      "Kitten",
      "Puppy",
      "Calf",
      "Cub"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Science / EVS",
    "questionText": "Which part of a plant grows below the ground?",
    "options": [
      "Leaf",
      "Flower",
      "Stem",
      "Root"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Science / EVS",
    "questionText": "Which of the following is a healthy food that you should eat every day?",
    "options": [
      "Burger",
      "Pizza",
      "Apple",
      "Potato chips"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Science / EVS",
    "questionText": "Where is a pet dog usually kept?",
    "options": [
      "Kennel",
      "Shed",
      "Nest",
      "Den"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science / EVS",
    "questionText": "In which season do we wear warm woolen clothes like sweaters and jackets?",
    "options": [
      "Summer",
      "Winter",
      "Monsoon",
      "Spring"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science / EVS",
    "questionText": "Which of the following vehicles travels on iron tracks?",
    "options": [
      "Bus",
      "Train",
      "Boat",
      "Aeroplane"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science / EVS",
    "questionText": "Which of these is a living thing that needs food and water to grow?",
    "options": [
      "A toy car",
      "A wooden table",
      "A cat",
      "A glass marble"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science / EVS",
    "questionText": "What shines brightly in the sky during the day and gives us heat and light?",
    "options": [
      "The Moon",
      "The Stars",
      "The Sun",
      "A Rainbow"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science / EVS",
    "questionText": "For our safety, we should cross the road only at the _________.",
    "options": [
      "Zebra crossing",
      "Footpath",
      "Middle of the road",
      "Signal pole"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "English",
    "questionText": "What is the exact opposite of the word \"HAPPY\"?",
    "options": [
      "Sad",
      "Big",
      "Fast",
      "Hot"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "English",
    "questionText": "Choose the correct vowel to complete the word for an animal that lives in water: F _ S H",
    "options": [
      "A",
      "E",
      "I",
      "O"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "English",
    "questionText": "What is the correct plural form of the word \"BOOK\"?",
    "options": [
      "Bookes",
      "Books",
      "Buk",
      "Book"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "English",
    "questionText": "Fill in the blank with the correct article: \"I saw ___ elephant in the zoo.\"",
    "options": [
      "a",
      "an",
      "the",
      "none of these"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "English",
    "questionText": "Which of the following words rhymes with \"CAT\"?",
    "options": [
      "Dog",
      "Mat",
      "Car",
      "Pen"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "English",
    "questionText": "Identify the naming word (noun) in this sentence: \"The boy is running.\"",
    "options": [
      "The",
      "boy",
      "is",
      "running"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "English",
    "questionText": "What is the feminine (female) word for \"KING\"?",
    "options": [
      "Prince",
      "Princess",
      "Queen",
      "Woman"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "English",
    "questionText": "Fill in the blank with the correct action word (verb): \"Birds ____ in the sky.\"",
    "options": [
      "walk",
      "fly",
      "swim",
      "run"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "English",
    "questionText": "Unscramble the letters B-R-I-D to form a meaningful word:",
    "options": [
      "DIRB",
      "BIRD",
      "RIBD",
      "DRIB"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "English",
    "questionText": "A person who teaches students in a school is called a:",
    "options": [
      "Doctor",
      "Tailor",
      "Teacher",
      "Farmer"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "Logical Reasoning",
    "questionText": "Find the odd one out from the following group:",
    "options": [
      "Apple",
      "Banana",
      "Potato",
      "Mango"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "It is a vegetable, the rest are fruits"
  },
  {
    "questionNumber": 32,
    "subject": "Logical Reasoning",
    "questionText": "What comes next in the letter pattern: A, C, E, G, ___?",
    "options": [
      "H",
      "I",
      "J",
      "K"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Skipping one letter each time"
  },
  {
    "questionNumber": 33,
    "subject": "Logical Reasoning",
    "questionText": "Dog is to Puppy as Cat is to _______.",
    "options": [
      "Calf",
      "Cub",
      "Kitten",
      "Foal"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "Logical Reasoning",
    "questionText": "Complete the number pattern: 10, 20, 30, 40, ___",
    "options": [
      "45",
      "50",
      "60",
      "100"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "Logical Reasoning",
    "questionText": "Rahul is standing in a line. He is 2nd from the front. There are 5 children in the line. How many children are standing behind Rahul?",
    "options": [
      "1",
      "2",
      "3",
      "4"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "Achievers / HOTS",
    "questionText": "Anya has a ₹50 note. She buys a toy car for ₹30 and a chocolate for ₹10. How much money is left with her?",
    "options": [
      "₹10",
      "₹20",
      "₹15",
      "₹5"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "She spent 30 + 10 = ₹40. 50 - 40 = ₹10 left"
  },
  {
    "questionNumber": 37,
    "subject": "Achievers / HOTS",
    "questionText": "In a farm, there are 2 cows and 3 hens. How many legs are there in total?",
    "options": [
      "12",
      "14",
      "16",
      "10"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Cows: 2 x 4 = 8 legs. Hens: 3 x 2 = 6 legs. 8 + 6 = 14"
  },
  {
    "questionNumber": 38,
    "subject": "Achievers / HOTS",
    "questionText": "Today is Wednesday. Reena's birthday is exactly after 3 days. On which day is Reena's birthday?",
    "options": [
      "Friday",
      "Sunday",
      "Saturday",
      "Monday"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "Thursday is 1 day, Friday is 2 days, Saturday is 3 days after"
  },
  {
    "questionNumber": 39,
    "subject": "Achievers / HOTS",
    "questionText": "A whole pizza is cut into 8 equal slices. Rahul eats 2 slices and his sister eats 3 slices. How many slices are left?",
    "options": [
      "2",
      "3",
      "4",
      "5"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "They ate 2 + 3 = 5 slices. 8 - 5 = 3 slices left"
  },
  {
    "questionNumber": 40,
    "subject": "Achievers / HOTS",
    "questionText": "If 1 apple weighs the same as 3 strawberries, how many strawberries will weigh the same as 2 apples?",
    "options": [
      "4",
      "5",
      "6",
      "8"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "1 apple = 3. So, 2 apples = 3 + 3 = 6"
  }
];

module.exports = { sections, questions };
