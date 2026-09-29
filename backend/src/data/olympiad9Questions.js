// LearnIQ – All India Olympiad Examination 2026 (Standard 9)
// Source: "LearnIQ_Test_9th_Standard_Question_Paper.pdf" (official PDF, 9 pages).
// 60 questions, 60 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own
// "Correct Answer" line under every question; it was cross-checked against the paper's
// "Answer Key (Quick Check)" table (0 mismatches). Questions contain no images/diagrams.
// Powers that the PDF stores as separate glyphs are restored (x², a², (256)^0.16).

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
    "questionText": "The value of (256)^0.16 × (256)^0.09 is:",
    "options": [
      "2",
      "4",
      "8",
      "16"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "The zero of the polynomial p(x) = 2x + 5 is:",
    "options": [
      "5/2",
      "2/5",
      "−5/2",
      "−2/5"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "Which of the following is an irrational number?",
    "options": [
      "√49",
      "0.333…",
      "22/7",
      "√7"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "The angles of a triangle are in the ratio 2 : 3 : 4. The largest angle is:",
    "options": [
      "60°",
      "70°",
      "80°",
      "90°"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "The distance of the point (3, −4) from the x-axis is:",
    "options": [
      "3 units",
      "4 units",
      "5 units",
      "7 units"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "If x + y = 10 and xy = 21, then x² + y² is:",
    "options": [
      "58",
      "79",
      "121",
      "142"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "The area of a triangle with sides 5 cm, 12 cm and 13 cm is:",
    "options": [
      "10 cm²",
      "15 cm²",
      "25 cm²",
      "30 cm²"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "Which point lies on the line 2x + 3y = 12?",
    "options": [
      "(3, 2)",
      "(2, 3)",
      "(1, 3)",
      "(0, 3)"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "The surface area of a sphere is 616 cm². Its radius is (take π = 22/7):",
    "options": [
      "3.5 cm",
      "7 cm",
      "14 cm",
      "28 cm"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "The mean of 5 numbers is 20. When one number is removed, the mean of the remaining numbers becomes 18. The removed number is:",
    "options": [
      "24",
      "26",
      "28",
      "30"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 11,
    "subject": "Mathematics",
    "questionText": "A fair die is thrown once. The probability of getting a prime number is:",
    "options": [
      "1/3",
      "1/2",
      "2/3",
      "5/6"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Mathematics",
    "questionText": "In a parallelogram ABCD, ∠A = 70°. Then ∠B is:",
    "options": [
      "70°",
      "90°",
      "100°",
      "110°"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Mathematics",
    "questionText": "A chord of length 16 cm is drawn in a circle of radius 10 cm. The distance of the chord from the centre is:",
    "options": [
      "6 cm",
      "8 cm",
      "10 cm",
      "12 cm"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Mathematics",
    "questionText": "The remainder when p(x) = x³ − 3x² + 5x − 7 is divided by (x − 1) is:",
    "options": [
      "−4",
      "−6",
      "4",
      "6"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 15,
    "subject": "Mathematics",
    "questionText": "Two supplementary angles are in the ratio 4 : 5. The smaller angle is:",
    "options": [
      "60°",
      "72°",
      "80°",
      "100°"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science",
    "questionText": "The SI unit of force is:",
    "options": [
      "Joule",
      "Newton",
      "Pascal",
      "Watt"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science",
    "questionText": "A speed of 72 km/h is equal to:",
    "options": [
      "10 m/s",
      "15 m/s",
      "20 m/s",
      "25 m/s"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 18,
    "subject": "Science",
    "questionText": "A car starting from rest reaches a speed of 20 m/s in 5 s. Its acceleration is:",
    "options": [
      "4 m/s²",
      "5 m/s²",
      "10 m/s²",
      "100 m/s²"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science",
    "questionText": "The momentum of a 2 kg object moving with a velocity of 5 m/s is:",
    "options": [
      "2.5 kg m/s",
      "7 kg m/s",
      "10 kg m/s",
      "25 kg m/s"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 20,
    "subject": "Science",
    "questionText": "Which of the following is a mixture?",
    "options": [
      "Distilled water",
      "Oxygen",
      "Common salt",
      "Air"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "Science",
    "questionText": "An element has the electronic configuration 2, 8, 3. Its atomic number is:",
    "options": [
      "11",
      "12",
      "13",
      "14"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "Science",
    "questionText": "The number of neutrons in an atom of aluminium (mass number 27, atomic number 13) is:",
    "options": [
      "13",
      "14",
      "27",
      "40"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "Science",
    "questionText": "Which cell organelle is known as the “powerhouse of the cell”?",
    "options": [
      "Ribosome",
      "Mitochondria",
      "Nucleus",
      "Golgi apparatus"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 24,
    "subject": "Science",
    "questionText": "Which tissue transports water and minerals from roots to leaves in plants?",
    "options": [
      "Xylem",
      "Phloem",
      "Collenchyma",
      "Parenchyma"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "Science",
    "questionText": "The speed of sound is greatest in:",
    "options": [
      "Vacuum",
      "Air",
      "Water",
      "Iron"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "Science",
    "questionText": "The kinetic energy of a 4 kg body moving at 3 m/s is:",
    "options": [
      "6 J",
      "12 J",
      "18 J",
      "36 J"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "Science",
    "questionText": "12 g of carbon burns completely in 32 g of oxygen. According to the law of conservation of mass, the mass of carbon dioxide formed is:",
    "options": [
      "12 g",
      "20 g",
      "32 g",
      "44 g"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "Science",
    "questionText": "Which of the following diseases is caused by a virus?",
    "options": [
      "Dengue",
      "Malaria",
      "Typhoid",
      "Cholera"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 29,
    "subject": "Science",
    "questionText": "A body has a mass of 60 kg on the Earth (g = 10 m/s²). Its weight on the Moon, where gravity is 1/6 of that on Earth, is:",
    "options": [
      "60 N",
      "100 N",
      "360 N",
      "600 N"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "Science",
    "questionText": "Osmosis is the net movement of water molecules through a semi-permeable membrane from a region of:",
    "options": [
      "higher solute concentration to lower solute concentration",
      "lower water concentration to higher water concentration",
      "higher water concentration to lower water concentration",
      "any concentration to any other through a rigid wall"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "English",
    "questionText": "Choose the correct option: Neither of the boys ______ present in the class today.",
    "options": [
      "are",
      "were",
      "is",
      "have been"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 32,
    "subject": "English",
    "questionText": "Choose the word closest in meaning to “benevolent”:",
    "options": [
      "Cruel",
      "Kind",
      "Careless",
      "Angry"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 33,
    "subject": "English",
    "questionText": "Choose the word opposite in meaning to “scarce”:",
    "options": [
      "Rare",
      "Limited",
      "Meagre",
      "Abundant"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 34,
    "subject": "English",
    "questionText": "What does the idiom “a blessing in disguise” mean?",
    "options": [
      "A misfortune that eventually turns out to be good",
      "A person who hides their good qualities",
      "A secret gift given by elders",
      "A costume worn at a party"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 35,
    "subject": "English",
    "questionText": "Fill in the blank: She has been working in this school ______ 2019.",
    "options": [
      "for",
      "since",
      "from",
      "by"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 36,
    "subject": "English",
    "questionText": "Change into passive voice: “The teacher praised the student.”",
    "options": [
      "The student praised the teacher.",
      "The student is praised by the teacher.",
      "The student was praised by the teacher.",
      "The student has been praised by the teacher."
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 37,
    "subject": "English",
    "questionText": "Choose the correctly spelt word:",
    "options": [
      "Accomodation",
      "Acommodation",
      "Accommadation",
      "Accommodation"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 38,
    "subject": "English",
    "questionText": "Identify the figure of speech: “The wind whispered through the trees.”",
    "options": [
      "Personification",
      "Simile",
      "Metaphor",
      "Hyperbole"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 39,
    "subject": "English",
    "questionText": "Change into indirect speech: He said, “I am tired.”",
    "options": [
      "He said that he is tired.",
      "He said that he was tired.",
      "He said that I was tired.",
      "He said that he will be tired."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 40,
    "subject": "English",
    "questionText": "Read the passage and answer.\nRahul woke up early every day to practise cricket. Even after failing the selection trials twice, he never gave up. In the third year, he was selected for the state team.\nWhich quality of Rahul is shown most clearly in the passage?",
    "options": [
      "Laziness",
      "Jealousy",
      "Perseverance",
      "Carelessness"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 41,
    "subject": "Social Science / Reasoning",
    "questionText": "The French Revolution began in the year:",
    "options": [
      "1776",
      "1789",
      "1799",
      "1815"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 42,
    "subject": "Social Science / Reasoning",
    "questionText": "Which French philosopher proposed the idea of separation of powers among the legislature, executive and judiciary?",
    "options": [
      "Rousseau",
      "Voltaire",
      "Montesquieu",
      "John Locke"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 43,
    "subject": "Social Science / Reasoning",
    "questionText": "The Standard Meridian of India (82°30′ E) passes through which of these states?",
    "options": [
      "Rajasthan",
      "Gujarat",
      "Maharashtra",
      "Uttar Pradesh"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 44,
    "subject": "Social Science / Reasoning",
    "questionText": "The outermost (southernmost) range of the Himalayas is known as:",
    "options": [
      "Shiwaliks",
      "Himachal",
      "Himadri",
      "Aravalli"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 45,
    "subject": "Social Science / Reasoning",
    "questionText": "The Constitution of India came into effect on:",
    "options": [
      "15 August 1947",
      "26 January 1950",
      "26 November 1949",
      "2 October 1950"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 46,
    "subject": "Social Science / Reasoning",
    "questionText": "Which of the following is an activity of the primary sector?",
    "options": [
      "Banking",
      "Teaching",
      "Farming",
      "Manufacturing"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 47,
    "subject": "Social Science / Reasoning",
    "questionText": "“Universal Adult Franchise” means that:",
    "options": [
      "only educated citizens can vote",
      "only property owners can vote",
      "only men can vote",
      "all adult citizens can vote irrespective of caste, gender or religion"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 48,
    "subject": "Social Science / Reasoning",
    "questionText": "Reasoning: Find the next number in the series 2, 6, 12, 20, 30, ___",
    "options": [
      "36",
      "40",
      "42",
      "48"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 49,
    "subject": "Social Science / Reasoning",
    "questionText": "Reasoning: If CAT is coded as DBU, then DOG is coded as:",
    "options": [
      "EPH",
      "EOG",
      "DPH",
      "EPG"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 50,
    "subject": "Social Science / Reasoning",
    "questionText": "Reasoning: Pointing to a photograph, a man said, “He is the son of my father’s only son.” How is the person in the photograph related to the man?",
    "options": [
      "Brother",
      "Son",
      "Nephew",
      "Cousin"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 51,
    "subject": "Achievers / HOTS",
    "questionText": "The sum of the digits of a two-digit number is 9. If the digits are reversed, the number increases by 27. The original number is:",
    "options": [
      "27",
      "36",
      "45",
      "63"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 52,
    "subject": "Achievers / HOTS",
    "questionText": "If a + 1/a = 5, then a² + 1/a² is equal to:",
    "options": [
      "19",
      "21",
      "23",
      "27"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 53,
    "subject": "Achievers / HOTS",
    "questionText": "A rectangular field is 40 m long and 30 m wide. A path 2 m wide is built all around the field, outside it. The area of the path is:",
    "options": [
      "240 m²",
      "264 m²",
      "280 m²",
      "296 m²"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 54,
    "subject": "Achievers / HOTS",
    "questionText": "A ball is thrown vertically upward and returns to the thrower’s hand after 6 s (g = 10 m/s²). The maximum height reached by the ball is:",
    "options": [
      "30 m",
      "45 m",
      "60 m",
      "90 m"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 55,
    "subject": "Achievers / HOTS",
    "questionText": "A force of 6 N acts on a 2 kg body, initially at rest, for 4 s. The kinetic energy gained by the body is:",
    "options": [
      "48 J",
      "72 J",
      "96 J",
      "144 J"
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 56,
    "subject": "Achievers / HOTS",
    "questionText": "A solid of mass 300 g completely displaces 120 cm³ of water when immersed. Its density and behaviour in water are:",
    "options": [
      "2.5 g/cm³; it sinks",
      "2.5 g/cm³; it floats",
      "0.4 g/cm³; it sinks",
      "0.4 g/cm³; it floats"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 57,
    "subject": "Achievers / HOTS",
    "questionText": "Dust flies out of a carpet when it is beaten with a stick. This happens because:",
    "options": [
      "friction between the stick and the dust pulls it out",
      "dust particles tend to remain at rest due to inertia when the carpet is suddenly moved",
      "gravity pushes the dust upward",
      "air pressure inside the carpet forces the dust out"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 58,
    "subject": "Achievers / HOTS",
    "questionText": "What is the angle between the hour hand and the minute hand of a clock at 3:30?",
    "options": [
      "75°",
      "90°",
      "105°",
      "120°"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 59,
    "subject": "Achievers / HOTS",
    "questionText": "In a class of 40 students, Amit’s rank from the top is 12. What is his rank from the bottom?",
    "options": [
      "27",
      "28",
      "29",
      "30"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 60,
    "subject": "Achievers / HOTS",
    "questionText": "A 150 m long train passes a pole in 15 s. How long will it take to completely cross a 350 m long platform at the same speed?",
    "options": [
      "35 s",
      "40 s",
      "50 s",
      "60 s"
    ],
    "correctAnswer": 2,
    "marks": 1
  }
];

module.exports = { sections, questions };
