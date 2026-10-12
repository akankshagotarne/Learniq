/**
 * LearnIQ BE Engineering Mock Test 2026 - Official Question Bank
 * Sourced directly from LearnIQ_BE_Students_MCQ_Test_Paper(1).pdf
 *
 * Total Questions: 40
 * Total Marks: 40
 * Marks Per Question: 1
 * Negative Marking: 0
 *
 * Section Distribution:
 * A. Programming Languages (Java, Python, C++): 10 questions (Q1 - Q10)
 * B. Operating Systems: 5 questions (Q11 - Q15)
 * C. Database Management Systems (DBMS): 5 questions (Q16 - Q20)
 * D. Logical Reasoning and Aptitude: 5 questions (Q21 - Q25)
 * E. Object-Oriented Programming (OOP): 5 questions (Q26 - Q30)
 * F. Data Structures and Algorithms (DSA Theory): 10 questions (Q31 - Q40)
 */

const SECTIONS = [
  { code: 'A', name: 'Programming Languages (Java, Python, C++)', count: 10, marks: 10 },
  { code: 'B', name: 'Operating Systems', count: 5, marks: 5 },
  { code: 'C', name: 'Database Management Systems (DBMS)', count: 5, marks: 5 },
  { code: 'D', name: 'Logical Reasoning and Aptitude', count: 5, marks: 5 },
  { code: 'E', name: 'Object-Oriented Programming (OOP)', count: 5, marks: 5 },
  { code: 'F', name: 'Data Structures and Algorithms (DSA Theory)', count: 10, marks: 10 },
];

const QUESTIONS = [
  // Section A: Programming Languages (Java, Python, C++)
  {
    questionNumber: 1,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'In Java, which statement about method overloading is correct?',
    options: [
      'It requires methods to have different return types only',
      'It allows methods with the same name but different parameter lists',
      'It can occur only between a parent and child class',
      'It is resolved only at runtime',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 2,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'What is the output of Python expression `type(3 / 2).__name__` in Python 3?',
    options: [
      'int',
      'float',
      'decimal',
      'rational',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 3,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'In C++, which feature allows a derived class to provide a specialized implementation of a base-class method?',
    options: [
      'Function overloading',
      'Operator precedence',
      'Function overriding',
      'Namespace aliasing',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 4,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'Which Java keyword prevents a class from being inherited?',
    options: [
      'static',
      'final',
      'private',
      'abstract',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 5,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'What is the average-case time complexity of searching for a key in a Python dictionary?',
    options: [
      'O(1)',
      'O(log n)',
      'O(n)',
      'O(n log n)',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 6,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'In C++, what is the primary purpose of a virtual destructor in a polymorphic base class?',
    options: [
      'To prevent object creation',
      'To make the class abstract',
      'To ensure the derived destructor runs when deleting through a base pointer',
      'To overload the delete operator',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 7,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'Which Python construct is commonly used to handle exceptions?',
    options: [
      'try-except',
      'for-in',
      'with-if',
      'def-catch',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 8,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'Which Java collection does not allow duplicate elements?',
    options: [
      'ArrayList',
      'LinkedList',
      'HashSet',
      'Vector',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 9,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: 'In C++, which cast is generally intended for safe conversions within an inheritance hierarchy using runtime type information?',
    options: [
      'static_cast',
      'reinterpret_cast',
      'const_cast',
      'dynamic_cast',
    ],
    correctAnswer: 3, // D
    marks: 1,
  },
  {
    questionNumber: 10,
    sectionCode: 'A',
    sectionName: 'Programming Languages (Java, Python, C++)',
    questionText: "What does Python's `__init__` method typically do?",
    options: [
      'Destroys an object',
      'Initializes a newly created object',
      'Imports a module',
      'Converts a class into a function',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },

  // Section B: Operating Systems
  {
    questionNumber: 11,
    sectionCode: 'B',
    sectionName: 'Operating Systems',
    questionText: 'Which scheduling algorithm can cause starvation of low-priority processes?',
    options: [
      'First-Come, First-Served',
      'Round Robin',
      'Priority Scheduling',
      'FIFO page replacement',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 12,
    sectionCode: 'B',
    sectionName: 'Operating Systems',
    questionText: 'A process is in the blocked state when it is typically:',
    options: [
      'Waiting for an event such as I/O completion',
      'Currently executing on the CPU',
      'Finished execution',
      'Newly admitted but not yet scheduled',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 13,
    sectionCode: 'B',
    sectionName: 'Operating Systems',
    questionText: 'Which condition is necessary for deadlock to occur?',
    options: [
      'Mutual exclusion',
      'Circular wait',
      'Hold and wait',
      'All of the above',
    ],
    correctAnswer: 3, // D
    marks: 1,
  },
  {
    questionNumber: 14,
    sectionCode: 'B',
    sectionName: 'Operating Systems',
    questionText: 'What is the main purpose of a Translation Lookaside Buffer (TLB)?',
    options: [
      'Store files permanently',
      'Cache recent virtual-to-physical address translations',
      'Schedule disk requests',
      'Detect CPU overheating',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 15,
    sectionCode: 'B',
    sectionName: 'Operating Systems',
    questionText: "Which page-replacement algorithm can exhibit Belady's anomaly?",
    options: [
      'LRU',
      'Optimal',
      'FIFO',
      'None of these',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },

  // Section C: Database Management Systems (DBMS)
  {
    questionNumber: 16,
    sectionCode: 'C',
    sectionName: 'Database Management Systems (DBMS)',
    questionText: 'Which ACID property ensures that a transaction is completed entirely or not at all?',
    options: [
      'Consistency',
      'Isolation',
      'Atomicity',
      'Durability',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 17,
    sectionCode: 'C',
    sectionName: 'Database Management Systems (DBMS)',
    questionText: 'A relation is in Third Normal Form (3NF) when, among other requirements, it has no:',
    options: [
      'Candidate keys',
      'Transitive dependency of non-key attributes on a key',
      'Foreign keys',
      'Composite attributes in every row',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 18,
    sectionCode: 'C',
    sectionName: 'Database Management Systems (DBMS)',
    questionText: 'Which SQL clause filters groups after aggregate functions are computed?',
    options: [
      'WHERE',
      'ORDER BY',
      'HAVING',
      'DISTINCT',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 19,
    sectionCode: 'C',
    sectionName: 'Database Management Systems (DBMS)',
    questionText: 'What does a foreign key primarily enforce?',
    options: [
      'Uniqueness in every column',
      'Referential integrity between tables',
      'Automatic indexing of all columns',
      'Encryption of a table',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 20,
    sectionCode: 'C',
    sectionName: 'Database Management Systems (DBMS)',
    questionText: 'Which index structure is commonly used by relational databases to support efficient range queries?',
    options: [
      'B-tree or B+ tree',
      'Stack',
      'Queue',
      'Hash table only',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },

  // Section D: Logical Reasoning and Aptitude
  {
    questionNumber: 21,
    sectionCode: 'D',
    sectionName: 'Logical Reasoning and Aptitude',
    questionText: 'A machine completes a task in 12 hours. Assuming a constant rate, what fraction of the task does it complete in 3 hours?',
    options: [
      '1/2',
      '1/3',
      '1/4',
      '1/6',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 22,
    sectionCode: 'D',
    sectionName: 'Logical Reasoning and Aptitude',
    questionText: 'Find the next number in the sequence: 3, 8, 15, 24, 35, __.',
    options: [
      '42',
      '46',
      '48',
      '50',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 23,
    sectionCode: 'D',
    sectionName: 'Logical Reasoning and Aptitude',
    questionText: 'All engineers in a team know programming. Some programmers know AI. Which conclusion must be true?',
    options: [
      'All engineers know AI',
      'Some engineers know AI',
      'All programmers are engineers',
      'No conclusion about engineers knowing AI necessarily follows',
    ],
    correctAnswer: 3, // D
    marks: 1,
  },
  {
    questionNumber: 24,
    sectionCode: 'D',
    sectionName: 'Logical Reasoning and Aptitude',
    questionText: 'A bag contains 4 red, 5 blue, and 3 green balls. What is the probability of randomly selecting a blue ball?',
    options: [
      '1/3',
      '5/12',
      '5/7',
      '3/12',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 25,
    sectionCode: 'D',
    sectionName: 'Logical Reasoning and Aptitude',
    questionText: 'If 5 workers finish a job in 18 days at the same rate, how many days would 6 workers take?',
    options: [
      '12',
      '15',
      '18',
      '21',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },

  // Section E: Object-Oriented Programming (OOP)
  {
    questionNumber: 26,
    sectionCode: 'E',
    sectionName: 'Object-Oriented Programming (OOP)',
    questionText: 'Which OOP principle bundles data and the methods operating on it while controlling access to internal state?',
    options: [
      'Encapsulation',
      'Inheritance',
      'Polymorphism',
      'Compilation',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 27,
    sectionCode: 'E',
    sectionName: 'Object-Oriented Programming (OOP)',
    questionText: 'When a subclass can be used wherever its superclass is expected without breaking correctness, this reflects:',
    options: [
      'Cohesion',
      'Liskov Substitution Principle',
      'Method hiding',
      'Data duplication',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 28,
    sectionCode: 'E',
    sectionName: 'Object-Oriented Programming (OOP)',
    questionText: 'Which relationship is best represented by composition?',
    options: [
      'A university has departments',
      'A square is a rectangle',
      'A dog is an animal',
      'A class implements an interface',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 29,
    sectionCode: 'E',
    sectionName: 'Object-Oriented Programming (OOP)',
    questionText: 'Which statement best distinguishes abstraction from encapsulation?',
    options: [
      'Abstraction exposes implementation details; encapsulation removes classes',
      'Abstraction focuses on essential behavior; encapsulation bundles state and controls access',
      'They are identical concepts',
      'Encapsulation applies only to procedural programming',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 30,
    sectionCode: 'E',
    sectionName: 'Object-Oriented Programming (OOP)',
    questionText: 'In runtime polymorphism in Java, which mechanism commonly selects the overridden instance method implementation?',
    options: [
      'Static binding at compile time',
      'Dynamic method dispatch',
      'Preprocessor expansion',
      'Constructor chaining',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },

  // Section F: Data Structures and Algorithms (Theory)
  {
    questionNumber: 31,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which data structure is most appropriate for implementing a function-call stack?',
    options: [
      'Queue',
      'Stack',
      'Graph',
      'Hash table',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 32,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'What is the worst-case time complexity of binary search on a sorted array?',
    options: [
      'O(1)',
      'O(log n)',
      'O(n)',
      'O(n log n)',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 33,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which traversal of a binary search tree visits keys in non-decreasing order?',
    options: [
      'Preorder',
      'Postorder',
      'Inorder',
      'Level order',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 34,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which collision-resolution technique stores colliding hash-table entries in a list or bucket at each index?',
    options: [
      'Separate chaining',
      'Binary search',
      'Merge sort',
      'Path compression',
    ],
    correctAnswer: 0, // A
    marks: 1,
  },
  {
    questionNumber: 35,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which algorithm is commonly used to find shortest paths from a single source in a graph with non-negative edge weights?',
    options: [
      "Kruskal's algorithm",
      "Dijkstra's algorithm",
      "Prim's algorithm",
      'DFS only',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 36,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'What is the worst-case time complexity of merge sort?',
    options: [
      'O(n)',
      'O(log n)',
      'O(n log n)',
      'O(n²)',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
  {
    questionNumber: 37,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which data structure is typically used by breadth-first search (BFS) to manage the frontier?',
    options: [
      'Stack',
      'Queue',
      'Heap only',
      'Disjoint-set forest',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 38,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'In a max-heap, which property must hold for every parent node and its children?',
    options: [
      'Parent is less than both children',
      'Parent is greater than or equal to its children',
      'The tree is always a binary search tree',
      'All leaves have the same value',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 39,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'What is the main advantage of an adjacency list over an adjacency matrix for a sparse graph?',
    options: [
      'It always gives O(1) edge lookup',
      'It uses less space when the graph has relatively few edges',
      'It sorts vertices automatically',
      'It eliminates graph traversal',
    ],
    correctAnswer: 1, // B
    marks: 1,
  },
  {
    questionNumber: 40,
    sectionCode: 'F',
    sectionName: 'Data Structures and Algorithms (DSA Theory)',
    questionText: 'Which statement about a stable sorting algorithm is correct?',
    options: [
      'It always runs in O(n)',
      'It uses no extra memory',
      'It preserves the relative order of equal-key elements',
      'It can sort only integers',
    ],
    correctAnswer: 2, // C
    marks: 1,
  },
];

module.exports = {
  SECTIONS,
  QUESTIONS,
};
