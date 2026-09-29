// LearnIQ – All India Olympiad Examination 2026 (Standard 3)
// Source: "CLASS  3 2026.pdf".
// 40 questions, 40 marks, 1 mark per question, NO negative marking (none is stated in the paper).
// correctAnswer is the zero-based option index (0=A, 1=B, 2=C, 3=D) taken from the paper's own "Answer:" line;
// the text of the keyed option was cross-checked against the answer text for all 40 questions (0 mismatches).
// The optional explanation is the parenthesised note printed after the answer in the paper (shown only in the post-submission review).
// Questions contain no images/diagrams.
// NOTE: Achievers/HOTS Q1 and Q4 print a duplicate "(C)" option letter in the paper — options were taken in printed order as A, B, C, D.

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
    "questionText": "What is the sum of the place values of 8 and 3 in the number 8432?",
    "options": [
      "8300",
      "8030",
      "830",
      "11"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Place value of 8 is 8000, place value of 3 is 30. 8000 + 30 = 8030"
  },
  {
    "questionNumber": 2,
    "subject": "Mathematics",
    "questionText": "Which of the following fractions is the largest?",
    "options": [
      "1/5",
      "½",
      "1/8",
      "1/4"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "When the numerators are the same, the fraction with the smallest denominator is the largest"
  },
  {
    "questionNumber": 3,
    "subject": "Mathematics",
    "questionText": "A stationary box contains 124 pencils. How many pencils are there in 5 such boxes?",
    "options": [
      "620",
      "600",
      "524",
      "720"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "124 × 5 = 620"
  },
  {
    "questionNumber": 4,
    "subject": "Mathematics",
    "questionText": "A magic show starts at 4:30 PM and ends at 6:45 PM. How long is the show?",
    "options": [
      "2 hours 15 minutes",
      "1 hour 45 minutes",
      "2 hours 30 minutes",
      "3 hours"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "From 4:30 PM to 6:30 PM is 2 hours, and from 6:30 PM to 6:45 PM is 15 minutes"
  },
  {
    "questionNumber": 5,
    "subject": "Mathematics",
    "questionText": "Rohan bought a toy for ₹145 and a storybook for ₹230. He gave a ₹500 note to the shopkeeper. How much change will he get back?",
    "options": [
      "₹115",
      "₹225",
      "₹125",
      "₹135"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "Total spent = 145 + 230 = ₹375. Change = 500 - 375 = ₹125"
  },
  {
    "questionNumber": 6,
    "subject": "Mathematics",
    "questionText": "How many edges (straight lines where two faces meet) does a cube have?",
    "options": [
      "6",
      "8",
      "12",
      "10"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "A cube has 6 faces, 8 corners/vertices, and 12 edges"
  },
  {
    "questionNumber": 7,
    "subject": "Mathematics",
    "questionText": "When 87 is divided by 9, what is the remainder?",
    "options": [
      "5",
      "6",
      "7",
      "8"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "9 × 9 = 81. 87 - 81 = 6. So, the remainder is 6"
  },
  {
    "questionNumber": 8,
    "subject": "Mathematics",
    "questionText": "3 meters and 45 centimeters is equal to how many centimeters in total?",
    "options": [
      "345 cm",
      "3045 cm",
      "3450 cm",
      "453 cm"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "1 meter = 100 cm. So, 3 meters = 300 cm. 300 + 45 = 345 cm"
  },
  {
    "questionNumber": 9,
    "subject": "Mathematics",
    "questionText": "What comes next in the following number pattern? 100, 90, 79, 67, ___",
    "options": [
      "54",
      "55",
      "56",
      "45"
    ],
    "correctAnswer": 0,
    "marks": 1,
    "explanation": "The pattern is decreasing by 10, then 11, then 12. Next, subtract 13. 67 - 13 = 54"
  },
  {
    "questionNumber": 10,
    "subject": "Mathematics",
    "questionText": "If Triangle + Triangle + Triangle = 24, and Square - Triangle = 5, what is the value of Square?",
    "options": [
      "12",
      "13",
      "14",
      "15"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "3 Triangles = 24, so 1 Triangle = 8. Square - 8 = 5, so Square = 8 + 5 = 13"
  },
  {
    "questionNumber": 11,
    "subject": "Science / EVS",
    "questionText": "Which part of the plant absorbs water and minerals from the soil and anchors the plant firmly?",
    "options": [
      "Stem",
      "Leaf",
      "Root",
      "Flower"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 12,
    "subject": "Science / EVS",
    "questionText": "A woodpecker has a strong, heavy, and chisel-shaped beak. What does it use this beak for?",
    "options": [
      "Tearing the flesh of other animals",
      "Cracking hard nuts and seeds",
      "Making holes in tree trunks to catch insects",
      "Sucking nectar from flowers"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 13,
    "subject": "Science / EVS",
    "questionText": "The brain, spinal cord, and nerves work together to control our body's actions. Which organ system do they form?",
    "options": [
      "Circulatory system",
      "Nervous system",
      "Digestive system",
      "Respiratory system"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 14,
    "subject": "Science / EVS",
    "questionText": "The Earth completes one revolution around the Sun in about 365 and 1/4 days. What does this movement cause on Earth?",
    "options": [
      "Day and night",
      "Changes in the phases of the Moon",
      "High and low tides",
      "Different seasons"
    ],
    "correctAnswer": 3,
    "marks": 1,
    "explanation": "Rotation causes day and night; revolution causes seasons"
  },
  {
    "questionNumber": 15,
    "subject": "Science / EVS",
    "questionText": "Which of the following states of matter has a fixed shape and a fixed volume?",
    "options": [
      "A wooden block (Solid)",
      "Milk (Liquid)",
      "Oxygen (Gas)",
      "Water vapor (Gas)"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 16,
    "subject": "Science / EVS",
    "questionText": "Why is a cactus plant able to survive in hot, dry deserts?",
    "options": [
      "It has broad leaves to catch rain.",
      "Its leaves are modified into sharp spines to prevent water loss.",
      "It has very shallow roots that do not need soil.",
      "It absorbs water from the air."
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 17,
    "subject": "Science / EVS",
    "questionText": "Animals like cows, sheep, and buffaloes first swallow their food without chewing it, and later bring it back to their mouth to chew it properly. What are such animals called?",
    "options": [
      "Scavengers",
      "Omnivores",
      "Ruminants",
      "Carnivores"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "Also known as animals that chew the cud"
  },
  {
    "questionNumber": 18,
    "subject": "Science / EVS",
    "questionText": "What is the process called when liquid water changes into water vapor upon heating?",
    "options": [
      "Condensation",
      "Freezing",
      "Evaporation",
      "Melting"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 19,
    "subject": "Science / EVS",
    "questionText": "How many bones are there in a fully grown adult human body?",
    "options": [
      "300",
      "206",
      "106",
      "260"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Babies are born with around 300 bones, which fuse as they grow"
  },
  {
    "questionNumber": 20,
    "subject": "Science / EVS",
    "questionText": "What is the correct and immediate first aid you should give if someone gets a minor burn on their hand?",
    "options": [
      "Wrap a tight cloth around it immediately.",
      "Apply hot water to the burnt area.",
      "Rub butter or oil over the burn.",
      "Hold the burnt area under cool running water."
    ],
    "correctAnswer": 3,
    "marks": 1
  },
  {
    "questionNumber": 21,
    "subject": "English",
    "questionText": "Which is the correct comparative form of the word \"Happy\"?",
    "options": [
      "Happyer",
      "Happiest",
      "Happier",
      "More happy"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 22,
    "subject": "English",
    "questionText": "Fill in the blank with the correct preposition: \"The clever fox jumped _____ the fence.\"",
    "options": [
      "in",
      "over",
      "under",
      "between"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 23,
    "subject": "English",
    "questionText": "Choose the correct pronoun to complete the sentence: \"Ravi and I are playing. _____ are best friends.\"",
    "options": [
      "They",
      "We",
      "He",
      "You"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Because the speaker 'I' is included, we use 'We'"
  },
  {
    "questionNumber": 24,
    "subject": "English",
    "questionText": "What is the antonym (opposite meaning) of the word \"EMPTY\"?",
    "options": [
      "Heavy",
      "Clean",
      "Full",
      "Hollow"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 25,
    "subject": "English",
    "questionText": "Fill in the blank with the correct past tense form: \"Yesterday, she _____ a beautiful song at the concert.\"",
    "options": [
      "sing",
      "sings",
      "sang",
      "singing"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 26,
    "subject": "English",
    "questionText": "Identify the word with the correct spelling:",
    "options": [
      "Tomorow",
      "Tomorrow",
      "Tommorrow",
      "Tommorow"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 27,
    "subject": "English",
    "questionText": "Fill in the blank with the correct joining word (conjunction): \"I wanted to go out and play, _____ it started raining heavily.\"",
    "options": [
      "but",
      "because",
      "or",
      "so"
    ],
    "correctAnswer": 0,
    "marks": 1
  },
  {
    "questionNumber": 28,
    "subject": "English",
    "questionText": "What is the correct collective noun for a group of bees?",
    "options": [
      "Herd",
      "Flock",
      "Swarm",
      "Pack"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "e.g., A herd of cows, a flock of birds, a pack of wolves, a swarm of bees"
  },
  {
    "questionNumber": 29,
    "subject": "English",
    "questionText": "Identify the describing word (adverb) that tells us how the action was done: \"The old tortoise walked very slowly.\"",
    "options": [
      "tortoise",
      "walked",
      "slowly",
      "The"
    ],
    "correctAnswer": 2,
    "marks": 1
  },
  {
    "questionNumber": 30,
    "subject": "English",
    "questionText": "Fill in the blank with the correct sound-alike word (homophone): \"The rope was tangled, and I could not untie this ______.\"",
    "options": [
      "not",
      "knot",
      "nut",
      "note"
    ],
    "correctAnswer": 1,
    "marks": 1
  },
  {
    "questionNumber": 31,
    "subject": "Logical Reasoning",
    "questionText": "What comes next in the following number pattern: 3, 6, 11, 18, 27, ___?",
    "options": [
      "36",
      "38",
      "39",
      "41"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "The difference between numbers is increasing by odd numbers: +3, +5, +7, +9. So, 27 + 11 = 38"
  },
  {
    "questionNumber": 32,
    "subject": "Logical Reasoning",
    "questionText": "In a certain secret code, if the word APPLE is written as BQQMF (each letter is shifted forward by 1), how will the word MANGO be written?",
    "options": [
      "NBPJP",
      "OCPHQ",
      "NBOHP",
      "NCOIQ"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "M->N, A->B, N->O, G->H, O->P"
  },
  {
    "questionNumber": 33,
    "subject": "Logical Reasoning",
    "questionText": "In a row of 15 students facing the blackboard, Rahul is standing 6th from the left end. What is his position from the right end?",
    "options": [
      "9th",
      "10th",
      "11th",
      "12th"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Total students = Left position + Right position - 1. So, 15 = 6 + Right - 1. Right = 15 - 5 = 10"
  },
  {
    "questionNumber": 34,
    "subject": "Logical Reasoning",
    "questionText": "Find the odd one out from the following group of words:",
    "options": [
      "Teacher",
      "Doctor",
      "Hospital",
      "Engineer"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "Hospital is a place of work, while the others are names of professions"
  },
  {
    "questionNumber": 35,
    "subject": "Logical Reasoning",
    "questionText": "Rohan is facing North. He turns to his right, walks straight for a while, and then turns to his right again. Which direction is he facing now?",
    "options": [
      "North",
      "East",
      "West",
      "South"
    ],
    "correctAnswer": 3,
    "marks": 1,
    "explanation": "Facing North -> 1st right turn makes him face East -> 2nd right turn makes him face South"
  },
  {
    "questionNumber": 36,
    "subject": "Achievers / HOTS",
    "questionText": "A train was scheduled to arrive at the station at 5:15 PM. It is delayed by exactly 45 minutes. If it takes Rohan 20 minutes to walk from the station to his house, at what time will he reach home?",
    "options": [
      "6:00 PM",
      "6:15 PM",
      "6:20 PM",
      "6:35 PM"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "5:15 PM + 45 minutes = 6:00 PM. 6:00 PM + 20 minutes walking = 6:20 PM"
  },
  {
    "questionNumber": 37,
    "subject": "Achievers / HOTS",
    "questionText": "Look at this simple food chain: Grass → Grasshopper → Frog → Snake. If a disease removes all the frogs from this area overnight, what is the most likely immediate result?",
    "options": [
      "The amount of grass will increase.",
      "The number of grasshoppers will increase.",
      "The number of snakes will increase.",
      "The grasshoppers will start eating snakes."
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Because their predator, the frog, is gone, fewer grasshoppers will be eaten"
  },
  {
    "questionNumber": 38,
    "subject": "Achievers / HOTS",
    "questionText": "Rahul had ₹200. He spent 1/4 of his money on a storybook and exactly half of his remaining money on a toy. How much money is left with him now?",
    "options": [
      "₹100",
      "₹75",
      "₹50",
      "₹25"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "1/4 of ₹200 = ₹50 spent on book. Remaining = ₹150. Half of ₹150 = ₹75 spent on toy. Left = 150 - 75 = ₹75"
  },
  {
    "questionNumber": 39,
    "subject": "Achievers / HOTS",
    "questionText": "3 apples weigh exactly the same as 1 mango. 2 mangoes weigh exactly the same as 1 melon. How many apples will weigh exactly the same as 2 melons?",
    "options": [
      "8",
      "10",
      "12",
      "6"
    ],
    "correctAnswer": 2,
    "marks": 1,
    "explanation": "1 Melon = 2 Mangoes = 6 Apples. So, 2 Melons = 6 + 6 = 12 Apples"
  },
  {
    "questionNumber": 40,
    "subject": "Achievers / HOTS",
    "questionText": "Riya kept a bowl of water outside in the bright afternoon sun. After a few hours, the water level went down. She then placed a cold plate over the bowl and left it for a while. Later, she saw water droplets on the underside of the plate. Which two processes did Riya observe in order?",
    "options": [
      "Melting and Freezing",
      "Evaporation and Condensation",
      "Freezing and Melting",
      "Boiling and Condensation"
    ],
    "correctAnswer": 1,
    "marks": 1,
    "explanation": "Water turning to vapor in the sun is evaporation; vapor turning back into droplets on the cold plate is condensation"
  }
];

module.exports = { sections, questions };
