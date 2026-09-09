export interface TeacherSpec {
  id: string;
  name: string;
  email: string;
  avatar: string;
  qualification: string;
  experience: string;
  bio: string;
  subjects: string[];
  standards: number[];
}

export interface SyllabusCourseSpec {
  id: string;
  title: string;
  standard: number;
  subject: string;
  teacherName: string;
  description: string;
  price: number;
  isFlagged: boolean;
  flagReason?: string;
  chapters: string[];
}

export const TEACHERS_DATA: TeacherSpec[] = [
  {
    id: 'teacher-sunita-sharma',
    name: 'Sunita Sharma',
    email: 'sunita.sharma@learniq.in',
    avatar: '/assets/teachers/sunita-sharma.jpg',
    qualification: 'M.A. Marathi Literature, B.Ed (Pune University)',
    experience: '14+ years',
    bio: 'Renowned Marathi language educator specializing in intuitive grammar, Devanagari phonetics, poetry analysis, and SSC board writing skills.',
    subjects: ['Marathi'],
    standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-rohit-gupta',
    name: 'Rohit Gupta',
    email: 'rohit.gupta@learniq.in',
    avatar: '/assets/teachers/rohit-gupta.jpg',
    qualification: 'M.Sc Applied Mathematics, B.Ed (IIT Bombay)',
    experience: '12+ years',
    bio: 'Empowers students to master mathematical logic, algebraic equations, and geometric constructions through visual step-by-step proofs.',
    subjects: ['Mathematics', 'Algebra', 'Geometry'],
    standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-aisha-khan',
    name: 'Aisha Khan',
    email: 'aisha.khan@learniq.in',
    avatar: '/assets/teachers/aisha-khan.jpg',
    qualification: 'M.A. English Literature, Cambridge CELTA Certified',
    experience: '10+ years',
    bio: 'Celebrated English literature specialist fostering fluent reading comprehension, vocabulary mastery, critical appreciation, and creative writing.',
    subjects: ['English'],
    standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-priya-patel',
    name: 'Priya Patel',
    email: 'priya.patel@learniq.in',
    avatar: '/assets/teachers/priya-patel.jpg',
    qualification: 'M.Sc Physics, B.Ed (Mumbai University)',
    experience: '11+ years',
    bio: 'Brings scientific phenomena to life with hands-on conceptual explanations spanning foundational EVS, General Science, and high school Physics & Chemistry.',
    subjects: ['Science', 'Environmental Studies', 'Science and Technology'],
    standards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-ravi-singh',
    name: 'Ravi Singh',
    email: 'ravi.singh@learniq.in',
    avatar: '/assets/teachers/ravi-singh.jpg',
    qualification: 'M.A. Hindi, Ph.D. in Linguistics (JNU)',
    experience: '15+ years',
    bio: 'Guides middle and secondary learners through Hindi Sulabhbharati and Lokbharati classics, literary depth, and SSC examination scoring methodologies.',
    subjects: ['Hindi'],
    standards: [5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-fatima-shaikh',
    name: 'Fatima Shaikh',
    email: 'fatima.shaikh@learniq.in',
    avatar: '/assets/teachers/fatima-shaikh.jpg',
    qualification: 'M.A. Ancient Indian History & Culture, B.Ed',
    experience: '13+ years',
    bio: 'Passionate historian bringing the legacy of Chhatrapati Shivaji Maharaj, constitutional governance, social evolution, and world civilizations into vivid perspective.',
    subjects: ['Social Science', 'History and Civics', 'History and Political Science', 'Environmental Studies'],
    standards: [4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: 'teacher-michael-desilva',
    name: 'Michael Desilva',
    email: 'michael.desilva@learniq.in',
    avatar: '/assets/teachers/michael-desilva.jpg',
    qualification: 'M.Sc Physical Geography & GIS, B.Ed',
    experience: '9+ years',
    bio: 'Geography educator and digital cartographer who makes climatology, ocean currents, topographical maps, and resource economics fascinating and accessible.',
    subjects: ['Geography'],
    standards: [6, 7, 8, 9, 10],
  },
];

export const SYLLABUS_COURSES: SyllabusCourseSpec[] = [
  // ================= STANDARD 1 =================
  {
    id: 'std-1-english',
    title: 'English — Std 1',
    standard: 1,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Foundational English course covering phonics, action songs, basic vocabulary, letters, and charming rhymes for Standard 1.',
    price: 99,
    isFlagged: false,
    chapters: [
      "A Happy Song", "Nature", "Action Time", "Know Each Other", "Let's Learn Alphabet", "Make Words", "Letters on a Tab and Computer Keyboard", "Sounds in the Middle of Words", "Soham's Ball", "Things that Go Together", "Number Song", "Rain", "Things in My Classroom", "Colours", "Magic Seed", "Who are you?", "Be Quick", "Bow, Wow", "Jungle Safari", "Toto – The Hen", "Let's Know More About Animals", "Surprise Birthday Party", "An Action Song", "Sunny and Mini", "Good Habits", "Favourite Things", "The Helpful Girl", "Word House", "Bicycle", "Where is the cat?", "We are Opposites", "Dough Shapes", "A Surprise For Grandma", "Tasty Treat", "Me, Myself and I", "Alphabet Song", "Shyam's Horse Cart", "Buying Things", "Everyday Things", "A Place for Everything and Everything in its Place", "The Ant and the Pigeon", "The Sun", "Traffic Rules", "A Shapes Mobile", "The Egg", "This – That", "The Monkey and the Log", "Tommy is Lost", "It's a Funny World", "Crossword"
    ],
  },
  {
    id: 'std-1-mathematics',
    title: 'Mathematics — Std 1',
    standard: 1,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Hands-on basic numeracy, counting 1 to 100, spatial awareness, shapes, and early addition/subtraction for Standard 1.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Small – Big", "Behind – In front of", "Above – Below", "Earlier – Later", "One – Many", "Find the difference", "Understand and write 1–9", "Zero", "Less – More", "Increasing – Decreasing order", "Let us 'Add'", "Let us learn subtraction", "Ten", "Let us learn 'Tens'", "11 to 20", "Steps of 'Ten'", "Coins and currency notes", "Let us observe and understand", "21–99", "Hundred", "Addition up to 20", "Addition by counting forward", "Patterns", "In – Out, Broad – Narrow", "Identifying shapes", "Long – Short", "Tall – Short", "Heavy – Light", "Near – Far", "Left – Right", "Less time – Less time", "What is next?", "Let us measure", "Days of a week"
    ],
  },
  {
    id: 'std-1-marathi',
    title: 'Marathi ("Majet Shikuya") — Std 1',
    standard: 1,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Joyful introduction to Marathi Devanagari letters, songs, and friendly vocabulary (Majet Shikuya).',
    price: 99,
    isFlagged: true,
    flagReason: '⚠️ Chapter list could not be independently verified from official eBalbharati scans. Placeholder outline provided pending official syllabus update.',
    chapters: [
      "अक्षर ओळख आणि गाणी (Introduction to Letters & Rhymes) [⚠️ Placeholder]",
      "चित्रे आणि शब्द (Picture Word Association) [⚠️ Placeholder]",
      "मजेदार गोष्टी (Interactive Stories) [⚠️ Placeholder]",
      "अंक आणि मोजणी १ ते १० (Numbers 1-10) [⚠️ Placeholder]",
      "बालगीते आणि संवाद (Child Songs & Conversation) [⚠️ Placeholder]"
    ],
  },

  // ================= STANDARD 2 =================
  {
    id: 'std-2-english',
    title: 'English — Std 2',
    standard: 2,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Standard 2 English curriculum encompassing four engaging units of narrative stories, poems, and foundational vocabulary.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Bridge", "Yash and Moti", "Chameleons", "Unity is Strength", "Friends Forever", "Mice", "Nina's Dream", "Five Little Seeds", "Catch Them, If You Can!", "What Do You See?", "My Telescope"
    ],
  },
  {
    id: 'std-2-mathematics',
    title: 'Mathematics — Std 2',
    standard: 2,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Geometry fundamentals, expanded place value, carry-over addition, subtraction by untying a ten, and simple multiplication.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Let's find the Shapes!", "Let's handle geometric shapes", "Fun with Line", "Let's identify geometrical shapes", "In the world of numbers", "Let's read and write in words", "Counting in groups", "Number given in a picture", "Place Value", "Expanded form of a number", "Counting in steps", "Fun with Addition", "Addition by counting forward", "Addition without carry over", "Addition/subtraction of Zero", "Stories of Addition-1", "Let's reduce by subtraction", "Addition and subtraction – a pair", "A subtraction story", "Twelve Months in a Year", "Comparing numbers", "Neighbouring numbers", "Ascending/Descending order", "Come, let's make numbers", "Cardinal/Ordinal numbers", "Reading Pictures", "Addition by carrying over", "Stories of Addition-2", "Subtraction by untying a ten", "Notes and Coins", "Let's measure Length", "Let's weigh", "Let's measure Capacity", "Managing Information", "Patterns", "Multiplication Preparation", "Let's make Tables", "Maths in a story"
    ],
  },
  {
    id: 'std-2-marathi',
    title: 'Marathi ("Majet Shikuya") — Std 2',
    standard: 2,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Progressive Marathi reading, barakhadi recognition, simple sentence formation, and interactive storytelling.',
    price: 99,
    isFlagged: true,
    flagReason: '⚠️ Chapter list could not be independently verified. Standard outline used pending confirmation.',
    chapters: [
      "चित्रवर्णन आणि शब्दभांडार (Picture Vocabulary) [⚠️ Placeholder]",
      "बाराखडी व वाचन (Barakhadi & Reading) [⚠️ Placeholder]",
      "बालकथा आणि कविता (Folk Tales & Poetry) [⚠️ Placeholder]",
      "संभाषण व छोटे संवाद (Daily Conversations) [⚠️ Placeholder]"
    ],
  },

  // ================= STANDARD 3 =================
  {
    id: 'std-3-english',
    title: 'English — Std 3',
    standard: 3,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Standard 3 English curriculum featuring 36 beloved prose passages, classic tales, humorous stories, and poems.',
    price: 99,
    isFlagged: false,
    chapters: [
      "A Pretty Game", "'Go!' and 'Come!'", "Tenali Raman Draws a Picture", "A String Song", "The Story of Sindbad the Sailor", "Khashaba Jadhav", "A Honey Bee Speaks", "Dress Quickly", "Pretty as a Picture", "The Sugar-Plum Tree", "Doctor Dolittle Learns Animal Language", "Let's Wait……!", "I'd Like to Be a Lighthouse", "Young Brave Hearts", "Young Scientist-1", "Curiosity", "Look Before You Leap!", "A Skit", "There Is the Key of the Kingdom", "A Team Of Workers", "The Two Merchants of Seri", "At the Market", "After School", "A School Teacher's Thoughts", "The Bremen Town Musicians", "Baby's Dress", "Young Scientist-2", "A Book Speaks", "Robotics", "The Noble Stag", "Washday", "At The Bottom of the Ocean", "Pinocchio", "Gadge Maharaj", "Bedtime", "The Magic Kettle"
    ],
  },
  {
    id: 'std-3-mathematics',
    title: 'Mathematics — Std 3',
    standard: 3,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Core mathematics for Std 3 covering numbers up to 3 digits, arithmetic operations, measurement, and fractions.',
    price: 99,
    isFlagged: true,
    flagReason: '⚠️ Thematic outline sourced from curriculum guide; verified Balbharati chapter titles will be updated on textbook release.',
    chapters: [
      "Geometrical Figures & Shapes [⚠️ Thematic Outline]",
      "Number Work: 3-Digit Numbers [⚠️ Thematic Outline]",
      "Addition with & without Carrying [⚠️ Thematic Outline]",
      "Subtraction by Borrowing [⚠️ Thematic Outline]",
      "Multiplication Concepts & Tables [⚠️ Thematic Outline]",
      "Division as Equal Sharing [⚠️ Thematic Outline]",
      "Measurement of Length, Weight & Capacity [⚠️ Thematic Outline]",
      "Time & Calendar Reading [⚠️ Thematic Outline]",
      "Fractions: Half, Quarter, Three-Quarters [⚠️ Thematic Outline]",
      "Handling Data & Pictorial Representation [⚠️ Thematic Outline]",
      "Patterns & Symmetry [⚠️ Thematic Outline]"
    ],
  },
  {
    id: 'std-3-evs',
    title: 'Environmental Studies (Parisar Abhyas) — Std 3',
    standard: 3,
    subject: 'Environmental Studies',
    teacherName: 'Priya Patel',
    description: 'Integrated exploration of natural habitats, human health, water cycles, sensory organs, and community life.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Our Environment", "So many kinds of animals!", "Animal Shelters", "Directions and Maps", "Understanding Time", "Getting to Know the Place we Live in", "Our Village, Our City", "Our Need for Water", "Where does water come from?", "More about Water", "Our Need for Air", "Our Need for Food", "Our Diet", "Inside the Kitchen!", "Our Body", "Sensory Organs", "Pearly Teeth, Healthy Body", "My Family and Home", "My School", "Our Community Life", "Public Services for Community Life", "Who fulfils our needs?", "Growing Up and Growing Old", "Our Clothes", "Changes in our Surroundings", "As we Go from the Third to the Fourth Standard"
    ],
  },
  {
    id: 'std-3-marathi',
    title: 'Marathi ("Sulabhbharati") — Std 3',
    standard: 3,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Standard 3 Marathi Sulabhbharati course building fluency in vocabulary, conversational etiquette, and short stories.',
    price: 99,
    isFlagged: true,
    flagReason: '⚠️ Chapter list could not be verified; book confirmed to exist. Standard outline provided pending confirmation.',
    chapters: [
      "प्रार्थना व स्वागतगीत (Welcome Prayer) [⚠️ Placeholder]",
      "गोष्टी आणि बालनाट्य (Stories & Short Plays) [⚠️ Placeholder]",
      "चित्रसंवाद (Visual Dialogue) [⚠️ Placeholder]",
      "व्याकरण व शब्दरचना (Basic Grammar & Words) [⚠️ Placeholder]"
    ],
  },

  // ================= STANDARD 4 =================
  {
    id: 'std-4-english',
    title: 'English — Std 4',
    standard: 4,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Rich English language & literature syllabus spanning 37 chapters of fables, informational articles, poetry, and creative tasks.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Rain in the Night", "Aesop's Fables", "Recess", "Your Own Book of Science", "Six Honest Serving-Men", "It's Only a Matter of Practice!", "Be a Writer-1", "A Great Leader", "Time for Everything", "Be a Craftsman! (Marbling)", "In the World of Dictionaries", "Why English is so Hard...", "Sultan Ghiyasuddin in the Qazi's Court", "My Books", "A Collage – Sachin Ramesh Tendulkar", "'Know' Formalities, Please – Part I & II", "Growing up", "The Ugly Duckling", "All about Glass", "Flint", "The Champa Flower", "Computers", "The Laughing King", "Little Words", "Be a Chef!", "The Dreadful Guest", "The Elf Singing", "Androcles and the Lion", "Young Scientist", "Be a Writer-2", "The Noble Monkey", "On Planting a Tree", "The King of the Golden River (Part I & II)", "A Farewell to the Teacher", "Ryokan and the Starfish"
    ],
  },
  {
    id: 'std-4-mathematics',
    title: 'Mathematics — Std 4',
    standard: 4,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Geometry figures, multi-digit arithmetic, perimeter, area, time measurement, pictographs, and fractions for Std 4.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Geometrical Figures", "Number Work", "Addition", "Subtraction", "Multiplication: Part 1", "Division: Part 1", "Coins and Notes", "Measuring Time", "Word Problems: Addition and Subtraction", "Fractions", "Measurement", "Perimeter and Area", "Multiplication: Part 2", "Division: Part 2", "Pictographs", "Patterns"
    ],
  },
  {
    id: 'std-4-evs-part-1',
    title: 'Environmental Studies Part 1 — Std 4',
    standard: 4,
    subject: 'Environmental Studies',
    teacherName: 'Priya Patel',
    description: 'Science-oriented EVS exploring animal life cycles, human physiology, natural water safety, diet, and community resilience.',
    price: 99,
    isFlagged: false,
    chapters: [
      "The Life Cycle of Animals", "The Inter-relationships between Living Things", "Storage of Water", "Water Safe for Drinking", "Water for Every Household", "Variety in Food", "Food and Nutrition", "The Value of Food", "Air", "Clothes", "A Look inside the Body", "Home Remedies for Simple Illnesses", "Directions and Maps", "Maps and Symbols", "My District, My State", "Day and Night", "My Upbringing", "Changes in the Family and Neighbourhood", "My Delightful School", "I'll be responsible and sensitive", "Management of Community Life", "Transport and Communication", "Natural Disasters", "Are we endangering our environment?"
    ],
  },
  {
    id: 'std-4-evs-part-2',
    title: 'Environmental Studies Part 2 (Chhatrapati Shivaji Maharaj) — Std 4',
    standard: 4,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'The inspiring historical biography of Chhatrapati Shivaji Maharaj, the foundation of Swaraj, famous battles, and welfare governance.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Maharashtra before Shivaji", "Work of the Saints", "Maratha Sardars – The Famous House of the Bhonsales", "Shivaji's Childhood", "Shivaji's Education", "The Oath of Swaraj", "Swaraj: First Conquest", "Defeat of Internal Enemies", "Pratapgad makes History", "Baji Prabhu and the Battle of Ghodkhind", "The Discomfiture of Shaistakhan", "The Siege of Purandar and Treaty with the Moghul Emperor", "Shivaji gives the slip to the Emperor", "The Fort is captured but the Lion is dead", "A Memorable Ceremony", "Campaign in the South", "Management of Forts and the Navy", "Management of the Welfare State of Swaraj"
    ],
  },
  {
    id: 'std-4-marathi',
    title: 'Marathi ("Sulabhbharati") — Std 4',
    standard: 4,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Std 4 Sulabhbharati syllabus featuring 25 inspiring poems, folk stories, moral essays, and vocabulary exercises.',
    price: 99,
    isFlagged: false,
    chapters: [
      "धरतीची आम्ही लेकरं", "बोलणारी नदी", "आम्हालाही हवाय मोबाईल", "या भारतात", "मला शिकायचंय", "मायेची पाखर", "धूळपेरणी", "गुणग्राहक राजा", "ईदगाह", "धाडसी हाली", "नाखवादादा, नाखवादादा", "वाटाड्या", "चवदार तळ्याचे पाणी", "मिठाचा शोध", "आनंदाचं झाड", "झुळूक मी व्हावे", "म्हणींच्या गमती", "जननायक बिरसा मुंडा", "हें कोण गे आई", "पाठ २० [⚠️ Pending confirmation]", "आभाळमाया स्वाध्याय", "होय मी सुद्धा", "मन्हा खान्देशी माटी", "थोर हुतात्मे", "संगणक"
    ],
  },

  // ================= STANDARD 5 =================
  {
    id: 'std-5-english',
    title: 'English — Std 5',
    standard: 5,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Comprehensive English reading and communication course covering 33 literary chapters, grammar, and speaking skills.',
    price: 99,
    isFlagged: false,
    chapters: [
      "What a Bird Thought", "Daydreams", "Be a Good Listener", "Strawberries", "The Twelve Months", "Announcements", "Major Dhyan Chand", "Peer Profile", "The Triantiwontigongolope", "Three Sacks of Rice", "Be a Good Speaker", "Count your Garden", "The Adventures of Gulliver", "A Lesson for All", "Bird Bath", "Write your own Story", "On the Water", "Weeds in the Garden", "Be a Good Host and Guest", "Only One Mother", "The Journey to the Great Oz", "A Book Review", "Write your own Poem", "Senses Alert", "The Man in the Moon", "Water in the Well", "The Legend of Marathon", "All about Money", "A Lark", "Be a Netizen", "Give your Mind a Workout!", "Helen Keller", "Rangoli"
    ],
  },
  {
    id: 'std-5-mathematics',
    title: 'Mathematics — Std 5',
    standard: 5,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Roman numerals, fractions, angles, circles, factors, decimal fractions, and essential algebraic foundations.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Roman Numerals", "Number Work", "Addition and Subtraction", "Multiplication and Division", "Fractions", "Angles", "Circles", "Multiples and Factors", "Decimal Fractions", "Measuring Time", "Problems on Measurement", "Perimeter and Area", "Three Dimensional Objects and Nets", "Pictographs", "Patterns", "Preparation for Algebra"
    ],
  },
  {
    id: 'std-5-evs-part-1',
    title: 'Environmental Studies Part 1 — Std 5',
    standard: 5,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'Natural science covering planetary motions, food preservation, internal human organs, and environmental balance.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Our Earth and Our Solar System", "Motions of the Earth", "The Earth and its Living World", "Environmental Balance", "Family Values", "Rules Are for Everyone", "Let us Solve our own Problems", "Public Facilities and My School", "Maps – our Companions", "Getting to Know India", "Our Home and Environment", "Food for All", "Methods of Preserving Food", "Transport", "Communication and Mass Media", "Water", "Clothes – our Necessity", "The Environment and Us", "Constituents of Food", "Our Emotional World", "Busy at Work – our Internal Organs", "Growth and Personality Development", "Infectious Diseases and how to Prevent them", "Substances, Objects and Energy", "Community Health and Hygiene"
    ],
  },
  {
    id: 'std-5-evs-part-2',
    title: 'Environmental Studies Part 2 ("How We Came to Be") — Std 5',
    standard: 5,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'The epic evolutionary history of humankind, the Stone Age, invention of tools, settled civilization, and the historic period.',
    price: 99,
    isFlagged: false,
    chapters: [
      "What is History?", "History and the Concept of 'Time'", "Life on Earth", "Evolution", "Evolution of Mankind", "Stone Age: Stone Tools", "From Shelters to Village-settlements", "Beginning of Settled Life", "Settled Life and Urban Civilization", "Historic Period"
    ],
  },
  {
    id: 'std-5-marathi',
    title: 'Marathi (Sulabhbharati) — Std 5',
    standard: 5,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Celebrated Marathi poems, moral stories, letter writing, comprehension, and practical grammar for Standard 5.',
    price: 99,
    isFlagged: false,
    chapters: [
      "नाच रे मोरा", "हत्तीचे चातुर्य", "खेळूया शब्दांशी", "ही पिसे कोणाची?", "डराव डराव", "ऐकूया खेळूया", "खेळत खेळत वाचूया!", "कोणापासून काय घ्यावे?", "सिंह आणि बेडूक", "बैलपोळा", "इंधनबचत", "बोलावे कसे?", "अनुभव-१", "चित्रसंदेश", "नदीचे गाणे", "मी नदी बोलते", "आमची सहल", "पैशांचे व्यवहार", "अनुभव-२", "गमतीदार पत्र", "छोटेसे बहीणभाऊ", "वाचूया लिहूया", "प्रामाणिक इस्त्रीवाला", "ऐका पहा करा", "मालतीची चतुराई", "पतंग", "महर्षी विठ्ठल रामजी शिंदे", "फुलपाखरू आणि मधमाशी"
    ],
  },
  {
    id: 'std-5-hindi',
    title: 'Hindi (Sulabhbharati) — Std 5',
    standard: 5,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: 'Entry-level Hindi curriculum covering 34 interactive lessons across two units, building solid reading and writing proficiency.',
    price: 99,
    isFlagged: false,
    chapters: [
      "नंदनवन", "बूँदें", "योग्य चुनाव", "कश्मीरा", "पहचान हमारी–भाग(१)", "पेटूराम", "बधाई कार्ड", "करो और जानो", "नीम", "गड़ा धन", "मित्रता", "बचत", "पहचान हमारी–भाग(२)", "मैं सड़क हूँ", "व्यायाम", "बोलो और जानो", "गाँव और शहर", "जीवन", "भाई-भाई का प्रेम", "बालिका दिवस", "रोबोट", "जुड़े हम", "बोध & समान–विरुद्ध", "बीज", "मुझे पहचानो", "मुझे जानो", "वीरों को प्रणाम", "सपूत", "राष्ट्रीय त्योहार", "हम अलग", "ज्ञानी", "बचाव", "निरिक्षण", "चलो-चलें"
    ],
  },

  // ================= STANDARD 6 =================
  {
    id: 'std-6-english',
    title: 'English ("Voyage") — Std 6',
    standard: 6,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: 'Four thematic Voyages spanning inspiring autobiographies, classic Shakespearean tales, and analytical reading.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Don't Give Up!", "Who's the Greatest?", "Autobiography of a Great Indian Bustard", "Children are Going to School…", "A Kabaddi Match", "The Peacock and the Crane", "Param Vir Chakra: Our Heroes", "The Clothesline", "The Worth of a Fabric", "A Wall Magazine for your Class!", "Anak Krakatoa", "The Silver House", "Ad'wise' Customers", "Yonamine and Bushi", "It Can Be Done", "Seven Sisters", "Stone Soup", "Sushruta (A Peep into the Past)", "The Donkey", "The Merchant of Venice", "At the Science Fair", "Sleep, My Treasure", "The Story of Gautama's Quest", "Mr Nobody", "A Mad Tea Party", "If I Can Stop One Heart From Breaking…", "The Phantom Tollbooth (Book Review)", "The Sword in the Stone", "An Autumn Greeting"
    ],
  },
  {
    id: 'std-6-mathematics',
    title: 'Mathematics — Std 6',
    standard: 6,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Integers, algebraic equations, divisibility rules, HCF-LCM, ratios, percentages, simple interest, and geometric properties.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Basic Concepts in Geometry", "Angles", "Integers", "Operations on Fractions", "Decimal Fractions", "Bar Graphs", "Symmetry", "Divisibility", "HCF-LCM", "Equations", "Ratio-Proportion", "Percentage", "Profit-Loss", "Banks and Simple Interest", "Triangles and their Properties", "Quadrilaterals", "Geometrical Constructions", "Three Dimensional Shapes"
    ],
  },
  {
    id: 'std-6-science',
    title: 'General Science — Std 6',
    standard: 6,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'Living world diversity, forces, simple machines, sound, light and shadows, magnetic principles, and the universe.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Natural Resources – Air, Water and Land", "The Living World", "Diversity in Living Things and their Classification", "Disaster Management", "Substances in the Surroundings", "Substances in Daily Use", "Nutrition and Diet", "Our Skeletal System and the Skin", "Motion and Types of Motion", "Force and Types of Force", "Work and Energy", "Simple Machines", "Sound", "Light and the Formation of Shadows", "Fun with Magnets", "The Universe"
    ],
  },
  {
    id: 'std-6-history-civics',
    title: 'History and Civics — Std 6',
    standard: 6,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'Ancient Indian history from Harappa to the Maurya Empire alongside local rural and urban government systems.',
    price: 99,
    isFlagged: false,
    chapters: [
      "The Indian Subcontinent and History", "Sources of History", "The Harappan Civilization", "The Vedic Civilization", "Religious Trends in Ancient India", "Janapadas and Mahajanapadas", "India during the Maurya Period", "States after the Maurya Empire", "Ancient Kingdoms of the South", "Ancient India: Cultural", "Ancient India and the World", "Our Life in Society", "Diversity in Society", "Rural Local Government Bodies", "Urban Local Government Bodies", "District Administration"
    ],
  },
  {
    id: 'std-6-geography',
    title: 'Geography — Std 6',
    standard: 6,
    subject: 'Geography',
    teacherName: 'Michael Desilva',
    description: 'Graticules, earth rotation, weather and climate, rock types, oceanic significance, and natural resource distribution.',
    price: 99,
    isFlagged: false,
    chapters: [
      "The Earth and the Graticule", "Let us Use the Graticule", "Comparing a Globe and a Map; Field Visits", "Weather and Climate", "Temperature", "Importance of Oceans", "Rocks and Rock Types", "Natural Resources", "Energy Resources", "Human Occupations"
    ],
  },
  {
    id: 'std-6-marathi',
    title: 'Marathi (Sulabhbharati) — Std 6',
    standard: 6,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: '17 rich Marathi chapters including patriotic songs, nature poetry, biographical excerpts, and communication exercises.',
    price: 99,
    isFlagged: false,
    chapters: [
      "भारतमाता", "माझा अनुभव", "पाऊस आला! पाऊस आला!", "माहिती घेऊया", "सुगरणीचे घरटे", "हे खरे खरे व्हावे...", "उद्यानात भेटलेला विद्यार्थी", "कुंदाचे साहस", "घर", "बाबांचं पत्र", "मिनूचा जलप्रवास", "चंद्रावरची शाळा", "मोठी आई", "अप्पाजींचे चातुर्य", "होळी आली होळी", "मुक्या प्राण्यांची कैफियत", "पाणपोई"
    ],
  },
  {
    id: 'std-6-hindi',
    title: 'Hindi (Sulabhbharati) — Std 6',
    standard: 6,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: '18 poetic and narrative Hindi lessons emphasizing moral virtues, environmental stewardship, and language mastery.',
    price: 99,
    isFlagged: false,
    chapters: [
      "सैर", "बसंती हवा", "उपहार", "जोकर", "आओ, आयु बताना सीखो / महाराष्ट्र की बेटी", "मेरा अहोभाग्य", "नदी कंधे पर", "जन्मदिन", "सोई मेरी छौना रे!", "उपयोग हमारे", "तूफानों से क्या डरना", "कठपुतली", "सोना और लोहा", "क्या तुम जानते हो?/पहेलियाँ", "स्वास्थ्य संपदा", "कागज की थैली", "टीटू और चिंकी", "वह देश कौन-सा है?"
    ],
  },

  // ================= STANDARD 7 =================
  {
    id: 'std-7-english',
    title: 'English — Std 7',
    standard: 7,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: '25 engaging literary chapters encompassing four units of classical prose, poetry, investigative mysteries, and grammar.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Past, Present, Future", "Odd One In", "In Time of Silver Rain", "The King's Choice", "Seeing Eyes Helping Hands", "A Collage", "From a Railway Carriage", "The Souvenir", "Abdul Becomes a Courtier", "How Doth the Little Busy Bee", "Learn Yoga from Animals", "Chasing the Sea Monster", "Great Scientists", "Tartary", "Compere a Programme", "A Crow in the House", "The Brook", "News Analysis", "Think Before You Speak!", "Under the Greenwood Tree", "Unke Munke Timpetoo", "The Red-Headed League", "Home Sweet Home", "Seeing Eyes Helping Hands", "Papa Panov's Special Christmas"
    ],
  },
  {
    id: 'std-7-mathematics',
    title: 'Mathematics — Std 7',
    standard: 7,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Rational numbers, indices, algebraic expansions, Pythagoras theorem, circles, and banking calculations for Std 7.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Geometrical Constructions", "Multiplication and Division of Integers", "HCF and LCM", "Angles and Pairs of Angles", "Operations on Rational Numbers", "Indices", "Joint Bar Graph", "Algebraic Expressions and Operations on them", "Direct Proportion and Inverse Proportion", "Banks and Simple Interest", "Circle", "Perimeter and Area", "Pythagoras' Theorem", "Algebraic Formulae – Expansion of Squares", "Statistics"
    ],
  },
  {
    id: 'std-7-science',
    title: 'General Science — Std 7',
    standard: 7,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'Plant physiology, static electricity, cellular structure, physical and chemical changes, heat, and stellar evolution.',
    price: 99,
    isFlagged: false,
    chapters: [
      "The Living World: Adaptations and Classification", "Plants: Structure and Function", "Properties of Natural Resources", "Nutrition in Living Organisms", "Food Safety", "Measurement of Physical Quantities", "Motion, Force and Work", "Static Electricity", "Heat", "Disaster Management", "Cell Structure and Micro-organisms", "The Muscular System and Digestive System in Human Beings", "Changes – Physical and Chemical", "Elements, Compounds and Mixtures", "Materials We Use", "Natural Resources", "Effects of Light", "Sound: Production of Sound", "Properties of a Magnetic Field", "In the World of Stars"
    ],
  },
  {
    id: 'std-7-history-civics',
    title: 'History and Civics — Std 7',
    standard: 7,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'Medieval India, the Maratha Empire, Maratha War of Independence, and fundamental constitutional rights and duties.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Sources of History", "India before the Times of Shivaji Maharaj", "Religious Synthesis", "Maharashtra before the Times of Shivaji Maharaj", "The Foundation of the Swaraj", "Conflict with the Mughals", "The Administration of the Swaraj", "An Ideal Ruler", "The Maratha War of Independence", "The Expansion of the Maratha Power", "Marathas – The Protectors of the Nation", "Progression of the Empire", "Life of the People in Maharashtra", "Introduction to Our Constitution", "Preamble to the Constitution", "Features of the Constitution", "Fundamental Rights Part 1", "Fundamental Rights Part 2", "Directive Principles of State Policy and Fundamental Duties"
    ],
  },
  {
    id: 'std-7-geography',
    title: 'Geography — Std 7',
    standard: 7,
    subject: 'Geography',
    teacherName: 'Michael Desilva',
    description: 'Seasonal cycles, tides, wind circulation, soil systems, global agricultural patterns, and contour map reading.',
    price: 99,
    isFlagged: false,
    chapters: [
      "How Seasons Occur Part 1", "The Sun, the Moon and the Earth", "Tides", "Air Pressure", "Winds", "Natural Regions", "Soils", "How Seasons Occur Part 2", "Agriculture", "Human Settlements", "Contour Maps and Landforms"
    ],
  },
  {
    id: 'std-7-marathi',
    title: 'Marathi (Sulabhbharati) — Std 7',
    standard: 7,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'Classic poems, historical bravery narratives, Santavani spiritual verses, and practical Marathi writing skills.',
    price: 99,
    isFlagged: false,
    chapters: [
      "प्रार्थना", "श्यामचे बंधुप्रेम", "माझ्या अंगणात", "गोपाळचे शौर्य", "दादास पत्र / आम्ही सूचनाफलक वाचतो", "टप् टप् पडती", "आजारी पडण्याचा प्रयोग / आपली समस्या आपले उपाय-१ / आम्ही जाहिरात वाचतो", "शब्दांचे घर", "वाचनाचे वेड / आम्ही बातमी वाचतो", "पंडिता रमाबाई", "लेक / आपली समस्या आपले उपाय-२", "रोजनिशी", "अदलाबदल", "संतवाणी"
    ],
  },
  {
    id: 'std-7-hindi',
    title: 'Hindi (Sulabhbharati) — Std 7',
    standard: 7,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: 'Two units of 16 classic prose and poetry entries cultivating linguistic sensitivity and communication eloquence.',
    price: 99,
    isFlagged: false,
    chapters: [
      "वाचन मेला", "फूल और काँटे", "दादी माँ का परिवार", "देहात और शहर", "बंदर का धंधा", "'पृथ्वी' से 'अग्नि' तक", "जहॉं चाह, वहाँ राह", "जीवन नहीं मरा करता है", "अस्पताल", "बेटी युग", "दाे लघुकथाएँ", "शब्द संपदा", "बसंत गीत", "चंदा मामा की जय", "रहस्य", "हम चलते सीना तान के"
    ],
  },

  // ================= STANDARD 8 =================
  {
    id: 'std-8-english',
    title: 'English — Std 8',
    standard: 8,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: '18 high-yield chapters covering poetry, historical speeches, mathematical biographies, and literary classics.',
    price: 99,
    isFlagged: false,
    chapters: [
      "A Time to Believe", "Dick Whittington and his Cat", "The Pilgrim", "Revathi's Musical Plants", "Vocation", "Nature Created Man and Woman as Equals", "The Worm", "Three Visions for India", "The Happy Prince", "The Plate of Gold", "The Kite Festival", "The Last Leaf", "Leisure", "The Vet", "Revolutionary Steps in Surgery", "The Bees", "Ramanujan", "A Battle to Baffle"
    ],
  },
  {
    id: 'std-8-mathematics',
    title: 'Mathematics — Std 8',
    standard: 8,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Rational & irrational numbers, polynomials, quadrilateral constructions, compound interest, volume, and circle geometry.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Rational and Irrational Numbers", "Parallel Lines and Transversal", "Indices and Cube Root", "Altitudes and Medians of a Triangle", "Expansion Formulae", "Factorisation of Algebraic Expressions", "Variation", "Quadrilateral: Constructions and Types", "Discount and Commission", "Division of Polynomials", "Statistics", "Equations in One Variable", "Congruence of Triangles", "Compound Interest", "Area", "Surface Area and Volume", "Circle: Chord and Arc"
    ],
  },
  {
    id: 'std-8-science',
    title: 'General Science — Std 8',
    standard: 8,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'Atomic structure, chemical bonds, human organ systems, acids and bases, current electricity, and light reflection.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Living World and Classification of Microbes", "Health and Diseases", "Force and Pressure", "Current Electricity and Magnetism", "Inside the Atom", "Composition of Matter", "Metals and Nonmetals", "Pollution", "Disaster Management", "Cell and Cell Organelles", "Human Body and Organ System", "Introduction to Acid and Base", "Chemical Change and Chemical Bond", "Measurement and Effects of Heat", "Sound", "Reflection of Light", "Man Made Materials", "Ecosystems", "Life Cycle of Stars"
    ],
  },
  {
    id: 'std-8-history-civics',
    title: 'History and Civics — Std 8',
    standard: 8,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: '20 integrated chapters tracing India’s Freedom Struggle, the 1857 Revolt, non-cooperation, parliament, and judiciary.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Sources of History", "Europe and India", "Effects of British Rule", "Introduction to the Parliamentary System (Civics)", "The Freedom Struggle of 1857", "Social and Religious Reforms", "Beginning of Freedom Movement", "Non-co-operation Movement", "The Indian Parliament (Civics)", "The Union Executive (Civics)", "Civil Disobedience Movement", "Last Phase of Struggle for Independence", "Armed Revolutionary Movement", "The Indian Judicial System (Civics)", "Struggle for Equality", "India Gains Independence", "Fulfillment of Struggle for Independence", "Formation of State of Maharashtra", "The State Government (Civics)", "Bureaucracy (Civics)"
    ],
  },
  {
    id: 'std-8-geography',
    title: 'Geography — Std 8',
    standard: 8,
    subject: 'Geography',
    teacherName: 'Michael Desilva',
    description: 'Standard time, earth interior, cloud formations, ocean floor topography, demographic studies, and field trip techniques.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Local Time and Standard Time", "Interior of the Earth", "Humidity and Clouds", "Structure of Ocean Floor", "Ocean Currents", "Land Use", "Population", "Industries", "Map Scale", "Field Trip"
    ],
  },
  {
    id: 'std-8-marathi',
    title: 'Marathi (Sulabhbharati) — Std 8',
    standard: 8,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: '13 expressive lessons featuring biographical recollections, mountaineering adventures, nature essays, and Santavani.',
    price: 99,
    isFlagged: false,
    chapters: [
      "आम्ही चालवू हा पुढे वारसा", "मी चित्रकार कसा झालो!", "प्रभात", "आपण सारे एक", "घाटात घाट वरंधाघाट", "आभाळाची अम्ही लेकरे", "नातवंडांस पत्र", "गिर्यारोहणाचा अनुभव", "झुळूक", "आम्ही हवे आहोत का?", "जीवन गाणे", "शब्दकोश", "संतवाणी"
    ],
  },
  {
    id: 'std-8-hindi',
    title: 'Hindi (Sulabhbharati) — Std 8',
    standard: 8,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: 'Two units of 18 thought-provoking Hindi essays, satirical dialogues, historical speeches, and moral poetry.',
    price: 99,
    isFlagged: false,
    chapters: [
      "हे मातृभूमि!", "वारिस कौन?", "नाखून क्यों बढ़ते हैं?", "गाँव-शहर", "मधुबन", "जरा प्यार से बोलना सीख लीजिए", "मेरे रजा साहब", "पूर्ण विश्राम", "अनमोल वाणी", "धरती का आँगन महके", "दो लघुकथाएँ", "लकड़हारा और वन", "सौहार्द-सौमनस्य", "खेती से आई तब्दीलियाँ", "अंधायुग", "स्वराज्य मेरा जन्मसिद्ध अधिकार है", "मेरा विद्रोह", "नहीं कुछ इससे बढ़कर"
    ],
  },

  // ================= STANDARD 9 =================
  {
    id: 'std-9-english',
    title: 'English — Std 9',
    standard: 9,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: '20 board-preparatory English chapters across four units, analyzing timeless classics, philosophical essays, and grammar.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Life", "A Synopsis - The Swiss Family Robinson", "Have You Ever Seen…?", "Have You Thought of the Verb 'Have'", "The Necklace", "Invictus", "A True Story of Sea Turtles", "Somebody's Mother", "The Fall of Troy", "Autumn", "The Past in the Present", "Silver", "Reading Works of Art", "The Road Not Taken", "How the First Letter Was Written", "Please Listen!", "The Storyteller", "Intellectual Rubbish", "My Financial Career", "Tansen"
    ],
  },
  {
    id: 'std-9-mathematics-part-1',
    title: 'Mathematics Part 1 (Algebra) — Std 9',
    standard: 9,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Sets, real numbers, polynomials, ratio & proportion, simultaneous linear equations, and financial planning.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Sets", "Real Numbers", "Polynomials", "Ratio and Proportion", "Linear Equations in Two Variables", "Financial Planning", "Statistics"
    ],
  },
  {
    id: 'std-9-mathematics-part-2',
    title: 'Mathematics Part 2 (Geometry) — Std 9',
    standard: 9,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'Parallel lines, triangle congruence, geometric constructions, coordinate geometry, trigonometry, and mensuration.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Basic Concepts in Geometry", "Parallel Lines", "Triangles", "Constructions of Triangles", "Quadrilaterals", "Circle", "Co-ordinate Geometry", "Trigonometry", "Surface Area and Volume"
    ],
  },
  {
    id: 'std-9-science-and-technology',
    title: 'Science and Technology — Std 9',
    standard: 9,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'Laws of motion, work & energy, electricity, acids and bases, cellular genetics, biotechnology, and space telescopes.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Laws of Motion", "Work and Energy", "Current Electricity", "Measurement of Matter", "Acids, Bases and Salts", "Classification of Plants", "Energy Flow in an Ecosystem", "Useful and Harmful Microbes", "Environmental Management", "Information Communication Technology (ICT)", "Reflection of Light", "Study of Sound", "Carbon: An Important Element", "Substances in Common Use", "Life Processes in Living Organisms", "Heredity and Variation", "Introduction to Biotechnology", "Observing Space: Telescopes"
    ],
  },
  {
    id: 'std-9-history-and-political-science',
    title: 'History and Political Science — Std 9',
    standard: 9,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'Post-1960 Indian development, internal security, defense systems, foreign policy, and the United Nations.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Sources of History", "India: Events after 1960", "India's Internal Challenges", "Economic Development", "Education", "Empowerment of Women and Other Weaker Sections", "Science and Technology", "Industry and Trade", "Changing Life-1", "Changing Life-2", "Post World War Political Developments", "India's Foreign Policy", "India's Defence System", "The United Nations", "India and Other Countries", "International Problems"
    ],
  },
  {
    id: 'std-9-geography',
    title: 'Geography — Std 9',
    standard: 9,
    subject: 'Geography',
    teacherName: 'Michael Desilva',
    description: 'Endogenetic/exogenetic earth movements, precipitation, sea water characteristics, trade, urbanisation, and international date lines.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Distributional Maps", "Endogenetic Movements", "Exogenetic Movements Part 1", "Exogenetic Movements Part 2", "Precipitation", "The Properties of Sea Water", "International Date Line", "Introduction to Economics", "Trade", "Urbanisation", "Transport and Communication", "Tourism"
    ],
  },
  {
    id: 'std-9-marathi',
    title: 'Marathi (Aksharbharati) — Std 9',
    standard: 9,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: '16 chapters of high school Marathi literature, Santkrupa devotional verses, biographical portraits, and Vishwakosh study.',
    price: 99,
    isFlagged: false,
    chapters: [
      "सर्वात्मका शिवसुंदरा", "संतवाणी – भेटीलागी जीवा/संतकृपा झाली", "'बेटा, मी ऐकतो आहे!'", "जी.आय.पी. रेल्वे/काझीरंगा", "व्यायामाचे महत्त्व", "ऑलिंपिक वर्तुळांचा गोफ", "दिव्याच्या शोधामागचे दिव्य", "सखू आजी/हास्यचित्रांतली मुलं", "उजाड उघडे माळरानही", "कुलूप", "आभाळातल्या पाऊलवाटा", "पुन्हा एकदा/व्हेनिस", "तिफन", "ते जीवनदायी झाड", "माझे शिक्षक व संस्कार", "शब्दांचा खेळ/विश्वकोश/उपयोजित लेखन"
    ],
  },
  {
    id: 'std-9-hindi',
    title: 'Hindi (Lokbharati) — Std 9',
    standard: 9,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: '22 rich literary entries across two parts cultivating Kabir dohās, contemporary short stories, and grammatical competence.',
    price: 99,
    isFlagged: false,
    chapters: [
      "चाँदनी रात", "बिल्ली का बिलुंगड़ा", "कबीर", "किताबें", "जूलिया", "ऐ सखि!", "डॉक्टर का अपहरण", "वीरभूमि पर कुछ दिन", "वरदान माँगूँगा नहीं", "रात का चौकीदार", "निर्माणों के पावन युग में", "कह कविराय", "जंगल", "इनाम", "सिंधु का जल", "अतीत के पत्र", "निसर्ग वैभव", "शिष्टाचार", "उड़ान", "मेरे पिता जी", "अपराजेय", "स्वतंत्रता गान"
    ],
  },

  // ================= STANDARD 10 (SSC BOARD EXAM) =================
  {
    id: 'std-10-english',
    title: 'English — Std 10 (SSC Board)',
    standard: 10,
    subject: 'English',
    teacherName: 'Aisha Khan',
    description: '24 pinnacle SSC board English chapters including Tagore’s anthem, world heritage explorations, critical book reviews, and writing skills.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Where the Mind is Without Fear", "The Thief's Story", "On Wings of Courage", "All the World's a Stage", "Joan of Arc", "The Alchemy of Nature", "Animals", "Three Questions", "Connecting the Dots", "The Pulley", "Let's March", "Science and Spirituality", "Night of the Scorpion", "The Night I Met Einstein", "Stephen Hawking", "The Will to Win", "Unbeatable — Super Mom-Mary Kom", "The Concert", "A Thing of Beauty is a Joy For Ever", "The Luncheon", "World Heritage", "The Height of the Ridiculous", "The Old Man and The Sea: Book Review", "The Gift of the Magi"
    ],
  },
  {
    id: 'std-10-mathematics-part-1',
    title: 'Mathematics Part 1 (Algebra) — Std 10',
    standard: 10,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'SSC board algebra covering linear equations in two variables, quadratics, arithmetic progressions, financial planning, and probability.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Linear Equations in Two Variables", "Quadratic Equations", "Arithmetic Progression", "Financial Planning", "Probability", "Statistics"
    ],
  },
  {
    id: 'std-10-mathematics-part-2',
    title: 'Mathematics Part 2 (Geometry) — Std 10',
    standard: 10,
    subject: 'Mathematics',
    teacherName: 'Rohit Gupta',
    description: 'SSC board geometry including similarity theorems, Pythagoras proofs, circle theorems, coordinate geometry, and trigonometry.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Similarity", "Pythagoras Theorem", "Circle", "Geometric Constructions", "Co-ordinate Geometry", "Trigonometry", "Mensuration"
    ],
  },
  {
    id: 'std-10-science-and-technology-part-1',
    title: 'Science and Technology Part 1 — Std 10',
    standard: 10,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'SSC Physics & Chemistry: Gravitation, periodic classification, electric currents, refraction, lenses, metallurgy, and carbon compounds.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Gravitation", "Periodic Classification of Elements", "Chemical Reactions and Equations", "Effects of Electric Current", "Heat", "Refraction of Light", "Lenses", "Metallurgy", "Carbon Compounds", "Space Missions"
    ],
  },
  {
    id: 'std-10-science-and-technology-part-2',
    title: 'Science and Technology Part 2 — Std 10',
    standard: 10,
    subject: 'Science',
    teacherName: 'Priya Patel',
    description: 'SSC Biology & Environment: Heredity and evolution, cellular processes, green energy, animal classification, and biotechnology.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Heredity and Evolution", "Life Processes in Living Organisms Part 1", "Life Processes in Living Organisms Part 2", "Environmental Management", "Towards Green Energy", "Animal Classification", "Introduction to Microbiology", "Cell Biology and Biotechnology", "Social Health", "Disaster Management"
    ],
  },
  {
    id: 'std-10-history-and-political-science',
    title: 'History and Political Science — Std 10',
    standard: 10,
    subject: 'History and Civics',
    teacherName: 'Fatima Shaikh',
    description: 'SSC historiography traditions, heritage tourism, Indian democracy dynamics, electoral processes, and social movements.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Historiography: Development in the West", "Historiography: Indian Tradition", "Applied History", "History of Indian Arts", "Mass Media and History", "Entertainment and History", "Sports and History", "Tourism and History", "Heritage Management", "Working of the Constitution", "The Electoral Process", "Political Parties", "Social and Political Movements", "Challenges Faced by Indian Democracy"
    ],
  },
  {
    id: 'std-10-geography',
    title: 'Geography — Std 10',
    standard: 10,
    subject: 'Geography',
    teacherName: 'Michael Desilva',
    description: 'SSC board comparative geography between India and Brazil across climate, physiography, wildlife, demographics, and economy.',
    price: 99,
    isFlagged: false,
    chapters: [
      "Field Visit", "Location and Extent", "Physiography and Drainage", "Climate", "Natural Vegetation and Wildlife", "Population", "Human Settlements", "Economy and Occupations", "Tourism, Transport and Communication"
    ],
  },
  {
    id: 'std-10-marathi',
    title: 'Marathi (Aksharbharati) — Std 10',
    standard: 10,
    subject: 'Marathi',
    teacherName: 'Sunita Sharma',
    description: 'SSC Marathi board exam curriculum including Saint Tukaram verses, classic prose, Vyuptpatti Kosh etymology, and essay skills.',
    price: 99,
    isFlagged: false,
    chapters: [
      "तू बुद्धी दे", "संतवाणी – अंकिला मी दास तुझा/योगी सर्वकाळ सुखदाता", "शाल", "उपास/मोठे होत असलेल्या मुलांनो...", "दोन दिवस", "चुडीवाला", "फूटप्रिन्टस", "ऊर्जाशक्तीचा जागर/जाता अस्ताला", "औक्षण", "रंग साहित्याचे", "जंगल डायरी", "रंग मजेचे रंग उदयाचे/जगणं कॅक्टसचं", "हिरवंगार झाडासारखं", "बीज पेरले गेले", "माझे शिक्षक व संस्कार", "स्वप्न करू साकार/व्युत्पत्ती कोश/उपयोजित लेखन"
    ],
  },
  {
    id: 'std-10-hindi',
    title: 'Hindi (Lokbharati) — Std 10',
    standard: 10,
    subject: 'Hindi',
    teacherName: 'Ravi Singh',
    description: 'SSC Hindi Lokbharati examination syllabus comprising 22 poems, humorous essays, and high-scoring board writing patterns.',
    price: 99,
    isFlagged: false,
    chapters: [
      "भारत महिमा", "लक्ष्मी", "वाह रे! हमदर्द", "मन", "गोवा: जैसा मैंने देखा", "गिरिधर नागर", "खुला आकाश", "गजल", "रीढ़ की हड्डी", "ठेस", "कृषक का गान", "बरषहिं जलद", "दो लघुकथाएँ", "श्रम साधना", "छापा", "ईमानदारी की प्रतिमूर्ति", "हम इस धरती की संतति हैं", "महिला आश्रम", "अपनी गंध नहीं बेचूँगा", "जब तक जिंदा रहूँ, लिखता रहूँ", "बूढ़ी काकी", "समता की ओर"
    ],
  },
];
