// The current exam (seeded once on first start; edit it afterwards from the admin dashboard).
// 30 choice questions (multiple choice, True/False, Yes/No), 3 ordering, 3 flowchart,
// 3 debugging and 1 Python coding question. Every question has an explanation for corrections.

export const CURRENT_EXAM_ID = 'algorithms-python';
export const CURRENT_EXAM_SEED_KEY = 'seed:algorithms-python:v1';

export const CURRENT_EXAM = {
  id: CURRENT_EXAM_ID,
  title: 'Algorithms, Flowcharts & Python Basics',
  description:
    'Algorithms, flowcharts and pseudocode, variables, data types and a little Python. 40 questions in 25 minutes.',
  durationSeconds: 25 * 60,
  // One attempt: corrections are released after 25 minutes, so a second attempt could copy them.
  maxAttempts: 1,
  published: true,
  archived: false,
};

const choice = (topic, text, optionTexts, correct, explanation, extra = {}) => ({
  topic,
  type: 'single',
  format: 'choice',
  text,
  optionTexts,
  correctOptionIds: [correct],
  explanation,
  ...extra,
});

const trueFalse = (topic, text, isTrue, explanation, extra = {}) => ({
  topic,
  type: 'single',
  format: 'true_false',
  text,
  correctOptionIds: [isTrue ? 'A' : 'B'],
  explanation,
  ...extra,
});

const yesNo = (topic, text, isYes, explanation, extra = {}) => ({
  topic,
  type: 'single',
  format: 'yes_no',
  text,
  correctOptionIds: [isYes ? 'A' : 'B'],
  explanation,
  ...extra,
});

export const CURRENT_EXAM_QUESTIONS = [
  // ------------------------------------------------------------- multiple choice (18)
  choice(
    'algorithms',
    'What is an algorithm?',
    [
      'A step-by-step set of instructions for solving a problem',
      'A type of computer virus',
      'A programming language',
      'A computer part that stores data',
    ],
    'A',
    'An algorithm is a clear, ordered list of steps that solves a problem. Recipes and directions to a place are everyday algorithms.'
  ),
  choice(
    'algorithms',
    'Which of these is the best example of an algorithm from everyday life?',
    ['A recipe for making jollof rice', 'A photograph of a cake', 'A song on the radio', 'A football'],
    'A',
    'A recipe gives steps to follow in order to get a result, which is exactly what an algorithm is.'
  ),
  choice(
    'algorithms',
    'Which of these is a property of a good algorithm?',
    [
      'Its steps are clear and in the right order',
      'It never comes to an end',
      'Its steps can be done in any order',
      'It must be written in Python',
    ],
    'A',
    'A good algorithm is precise, in the correct order, and finishes. It can be written in plain English, pseudocode or as a flowchart, not only in Python.'
  ),
  choice(
    'flowcharts',
    'In a flowchart, which shape is used for Start and Stop?',
    ['Oval (rounded rectangle)', 'Diamond', 'Rectangle', 'Parallelogram'],
    'A',
    'The oval, also called the terminator, marks where a flowchart starts and where it stops.'
  ),
  choice(
    'flowcharts',
    'Which flowchart shape shows a decision, such as a Yes/No question?',
    ['Diamond', 'Oval', 'Rectangle', 'Parallelogram'],
    'A',
    'A diamond holds a question. It has two exits, one for Yes and one for No.'
  ),
  choice(
    'flowcharts',
    'Which flowchart shape is used for input and output, such as “Enter your age” or “Display the total”?',
    ['Parallelogram', 'Diamond', 'Oval', 'Rectangle'],
    'A',
    'Input (getting data) and output (showing results) go in a parallelogram, the slanted box.'
  ),
  choice(
    'flowcharts',
    'In a flowchart, a rectangle is used for…',
    [
      'A process or calculation, such as total = a + b',
      'Starting the program',
      'Asking a Yes/No question',
      'Showing the end of the program',
    ],
    'A',
    'Rectangles hold processes: calculations and actions like total = a + b.'
  ),
  choice(
    'flowcharts',
    'What do the arrows in a flowchart show?',
    [
      'The order the steps are followed in',
      'Where the computer is plugged in',
      'Which step is the most important',
      'The end of the program',
    ],
    'A',
    'Arrows (flow lines) connect the shapes and show which step comes next.'
  ),
  choice(
    'pseudocode',
    'What is pseudocode?',
    [
      'A simple, English-like way of writing the steps of a program',
      'A secret code that only computers understand',
      'A program that is full of errors',
      'A type of flowchart shape',
    ],
    'A',
    'Pseudocode describes an algorithm in plain, structured English. It helps you plan a program before writing real code.'
  ),
  choice(
    'pseudocode',
    'Look at this pseudocode. What will be printed?',
    ['8', '5', '3', '0'],
    'A',
    'total starts at 0, then becomes 0 + 5 = 5, then 5 + 3 = 8. PRINT shows 8.',
    { code: 'SET total TO 0\nSET total TO total + 5\nSET total TO total + 3\nPRINT total', codeLanguage: 'text' }
  ),
  choice(
    'variables',
    'What is a variable in programming?',
    [
      'A named place that stores a value which can change',
      'A number that can never change',
      'A mistake in a program',
      'A type of computer screen',
    ],
    'A',
    'A variable is like a labelled box: it has a name and holds a value, and the value can be changed later.'
  ),
  choice(
    'variables',
    'Which of these is a valid variable name in Python?',
    ['student_name', 'student name', '2ndname', 'student-name'],
    'A',
    'Variable names cannot contain spaces or hyphens and cannot start with a number. Use an underscore (_) to join words.'
  ),
  choice(
    'variables',
    'What does this Python program print?',
    ['13', '12', '12 13', 'age'],
    'A',
    'A variable holds one value at a time. The second line replaces 12 with 13, so print(age) shows 13.',
    { code: 'age = 12\nage = 13\nprint(age)' }
  ),
  choice(
    'datatypes',
    'What is the data type of the value 25 in Python?',
    ['int (integer)', 'str (string)', 'float', 'bool (boolean)'],
    'A',
    '25 is a whole number without a decimal point, so it is an int.'
  ),
  choice(
    'datatypes',
    'Which of these values is a string (str) in Python?',
    ['"25"', '25', '25.0', 'True'],
    'A',
    'Anything inside quotation marks is a string, even if it looks like a number.'
  ),
  choice(
    'datatypes',
    'What is the data type of 3.75 in Python?',
    ['float', 'int', 'str', 'bool'],
    'A',
    'Numbers with a decimal point are floats.'
  ),
  choice(
    'python',
    'Which Python function shows text on the screen?',
    ['print()', 'input()', 'show()', 'display()'],
    'A',
    'print() displays output. input() is used to ask the user to type something.'
  ),
  choice(
    'python',
    'In Python, what data type does input() always give you?',
    ['str (string)', 'int', 'float', 'bool'],
    'A',
    'input() always returns text (a string). Use int() or float() to turn it into a number before doing maths with it.'
  ),

  // ------------------------------------------------------------- True / False (6)
  trueFalse(
    'algorithms',
    'The steps of an algorithm can be done in any order and still give the right result.',
    false,
    'False. Order matters: you cannot serve noodles before you cook them.'
  ),
  trueFalse(
    'flowcharts',
    'A flowchart is a diagram that shows the steps of an algorithm using shapes and arrows.',
    true,
    'True. Each shape is a step and the arrows show the order.'
  ),
  trueFalse(
    'python',
    'Python is case-sensitive, so name and Name are two different variables.',
    true,
    'True. Python treats capital and small letters as different, so name, Name and NAME are three different variables.'
  ),
  trueFalse(
    'datatypes',
    'In Python, True (without quotation marks) is a boolean (bool) value.',
    true,
    'True. Booleans have only two values, True and False.'
  ),
  trueFalse(
    'python',
    'In Python, the = sign is used to give (assign) a value to a variable.',
    true,
    'True. For example, age = 12 stores 12 in age. To compare two values, Python uses == instead.'
  ),
  trueFalse(
    'datatypes',
    'In Python, "5" + "5" gives 10.',
    false,
    'False. Both values are strings, so + joins them together to make "55".'
  ),

  // ------------------------------------------------------------- Yes / No (6)
  yesNo(
    'flowcharts',
    'Can a decision (diamond) in a flowchart have two paths coming out of it, one for Yes and one for No?',
    true,
    'Yes. A decision asks a question, and the flow continues down the Yes path or the No path.'
  ),
  yesNo(
    'variables',
    'Is my age (with a space in it) a valid variable name in Python?',
    false,
    'No. Variable names cannot contain spaces. Use my_age instead.'
  ),
  yesNo(
    'python',
    'Will print("Hello") display the word Hello on the screen?',
    true,
    'Yes. print() shows whatever is inside the brackets, and the quotes mark Hello as text.'
  ),
  yesNo(
    'pseudocode',
    'Is pseudocode mainly written for people to read, rather than for a computer to run directly?',
    true,
    'Yes. Pseudocode is for planning and explaining. It has to be turned into a real language like Python before a computer can run it.'
  ),
  yesNo(
    'datatypes',
    'Are 10 and 10.0 the same data type in Python?',
    false,
    'No. 10 is an int (whole number) and 10.0 is a float (decimal number).'
  ),
  yesNo(
    'python',
    'Will this program print 12?',
    true,
    'Yes. area = 4 * 3, and * means multiply, so the program prints 12.',
    { code: 'length = 4\nbreadth = 3\narea = length * breadth\nprint(area)' }
  ),

  // ------------------------------------------------------------- put the steps in order (3)
  {
    topic: 'algorithms',
    type: 'order',
    text: 'Put the steps for cooking Indomie noodles in the correct order.',
    items: [
      'Pour water into a pot',
      'Boil the water',
      'Put the noodles into the boiling water',
      'Cook for about 3 minutes, then add the seasoning',
      'Serve the noodles on a plate',
    ],
    explanation:
      'You need water before you can boil it, the water must boil before the noodles go in, and the noodles must be cooked before they are served.',
  },
  {
    topic: 'algorithms',
    type: 'order',
    text: 'Put the steps of an algorithm that finds the area of a rectangle in the correct order.',
    items: [
      'Start',
      'Input the length and the breadth',
      'Calculate area = length × breadth',
      'Display the area',
      'Stop',
    ],
    explanation:
      'Every algorithm begins with Start. You need the inputs before you can calculate, and you can only display the area after calculating it.',
  },
  {
    topic: 'pseudocode',
    type: 'order',
    text: 'Put the steps of an algorithm that checks whether a student passed (50 or more) in the correct order.',
    items: [
      'Start',
      'Input the score',
      'If the score is 50 or more, display "Pass"',
      'Otherwise, display "Fail"',
      'Stop',
    ],
    explanation:
      'The score must be entered before it can be checked. The "If" step comes before its "Otherwise" step, and Stop is always last.',
  },

  // ------------------------------------------------------------- flowcharts (3)
  {
    topic: 'flowcharts',
    type: 'flowchart',
    text: 'Complete the flowchart for finding the area of a rectangle. Choose the right step for each empty shape.',
    flowchart: {
      nodes: [
        { shape: 'terminal', text: 'Start' },
        { shape: 'io', text: 'Input length, breadth', blank: true },
        { shape: 'process', text: 'area = length × breadth', blank: true },
        { shape: 'io', text: 'Output area', blank: true },
        { shape: 'terminal', text: 'Stop' },
      ],
      distractors: ['Is area > 10?'],
    },
    explanation:
      'Input and output go in parallelograms, and the calculation goes in a rectangle. The input must come first and the output after the calculation.',
  },
  {
    topic: 'flowcharts',
    type: 'flowchart',
    text: 'Complete the flowchart that prints "Pass" for a score of 50 or more and "Fail" otherwise.',
    flowchart: {
      nodes: [
        { shape: 'terminal', text: 'Start' },
        { shape: 'io', text: 'Input score', blank: true },
        {
          shape: 'decision',
          text: 'Is score ≥ 50?',
          blank: true,
          yes: [{ shape: 'io', text: 'Print "Pass"', blank: true }],
          no: [{ shape: 'io', text: 'Print "Fail"', blank: true }],
        },
        { shape: 'terminal', text: 'Stop' },
      ],
      distractors: ['score = score + 50'],
    },
    explanation:
      'The score is input first (parallelogram). The question "Is score ≥ 50?" goes in the diamond; the Yes path prints "Pass" and the No path prints "Fail".',
  },
  {
    topic: 'flowcharts',
    type: 'flowchart',
    text: 'Complete the flowchart for the perimeter of a rectangle program. Choose the right step for each empty shape.',
    flowchart: {
      nodes: [
        { shape: 'terminal', text: 'Start' },
        { shape: 'io', text: 'Input length' },
        { shape: 'io', text: 'Input breadth', blank: true },
        { shape: 'process', text: 'perimeter = 2 × (length + breadth)', blank: true },
        { shape: 'io', text: 'Output perimeter', blank: true },
        { shape: 'terminal', text: 'Stop' },
      ],
      distractors: ['perimeter = length × breadth', 'Is length > breadth?'],
    },
    explanation:
      'After the length, the program needs the breadth (input). Then it calculates perimeter = 2 × (length + breadth) in a rectangle, and finally outputs the perimeter.',
  },

  // ------------------------------------------------------------- find the bug (3)
  choice(
    'python',
    'This program should print: My name is Henry. Instead it shows an error. Which line has the bug? (Press Run to see the error.)',
    ['Line 1', 'Line 2', 'Both lines', 'There is no bug'],
    'B',
    'Line 2 uses henry, but the variable is called name. Python thinks henry is a different variable that does not exist (NameError). The fix is print("My name is", name).',
    { code: 'name = "Henry"\nprint("My name is", henry)', lockOptionOrder: true }
  ),
  choice(
    'python',
    'This perimeter program runs, but prints the wrong answer. Which change fixes it? (Try it with Run.)',
    [
      'Change line 4 to: print("The perimeter is", perimeter)',
      'Change line 4 to: print("The perimeter is", length + breadth)',
      'Change line 3 to: perimeter = length * breadth',
      'Change line 4 to: print(The perimeter is, perimeter)',
    ],
    'A',
    'The calculation on line 3 is correct, but line 4 prints length instead of perimeter. The text in print() also needs its quotation marks.',
    {
      code: 'length = float(input("Enter length: "))\nbreadth = float(input("Enter breadth: "))\nperimeter = 2 * (length + breadth)\nprint("The perimeter is", length)',
      codeSampleInput: '4\n3',
    }
  ),
  choice(
    'python',
    'This program crashes with an error. What is the best fix? (Try it with Run.)',
    [
      'Change line 1 to: age = int(input("Enter your age: "))',
      'Change line 2 to: print("Next year you will be", age - 1)',
      'Remove the brackets from print on line 2',
      'Rename the variable age to Age',
    ],
    'A',
    'input() gives text, and Python cannot add the number 1 to text (TypeError). int() turns the text into a whole number so age + 1 works.',
    {
      code: 'age = input("Enter your age: ")\nprint("Next year you will be", age + 1)',
      codeSampleInput: '12',
    }
  ),

  // ------------------------------------------------------------- write a program (1)
  {
    topic: 'python',
    type: 'code',
    text:
      'Write a Python program that asks the user for two numbers and prints their sum.\nExample: if the user types 2 and then 3, your program should print 5. Use the Run button to test your program before you move on.',
    starterCode: '# Ask for the first number\n\n# Ask for the second number\n\n# Print the sum\n',
    codeSampleInput: '2\n3',
    tests: [
      { input: '2\n3', expected: '5', match: 'number' },
      { input: '10\n25', expected: '35', match: 'number' },
      { input: '7\n-4', expected: '3', match: 'number' },
    ],
    explanation:
      'One correct answer:\na = float(input("Enter the first number: "))\nb = float(input("Enter the second number: "))\nprint("The sum is", a + b)\ninput() gives text, so convert it with int() or float() first; otherwise "2" + "3" joins the text and gives "23".',
  },
];

// Hints are off by default. This exam gives 3 hints to the classes that had not yet taken the
// Python lesson when it was first set; change the number or the classes in the admin dashboard.
CURRENT_EXAM.hintsAllowed = 3;
CURRENT_EXAM.hintClasses = ['JSS1 B', 'JSS2 A', 'JSS2 B', 'JSS2 D', 'SS1 B', 'SS1 D'];
CURRENT_EXAM.hintNote =
  'Your class has not had the Python lesson yet, so you have 3 hints. Save them for the Python questions near the end.';

// One hint per question, in the same order as CURRENT_EXAM_QUESTIONS. A hint nudges; it never
// states the answer.
const HINTS = [
  'Think of a recipe. What does it give you?',
  'Which one tells you what to do, one step after another?',
  'Would a recipe still work if its steps were unclear or mixed up?',
  'It is the rounded shape at the very top and the very bottom of a flowchart.',
  'This shape has four points, and two arrows leave it.',
  'It looks like a rectangle that is leaning to one side.',
  'Think about where you would write area = length × breadth.',
  'Follow an arrow with your finger. Where does it take you?',
  '“Pseudo” means “not real”. It looks a bit like code, but it is written in plain English.',
  'Go through it one line at a time and keep track of what total is.',
  'Think of a labelled box that you can put a value into and change later.',
  'Names cannot contain spaces or hyphens, and cannot begin with a digit.',
  'The second line changes what is stored in age.',
  'Is it a whole number, a decimal number, or text?',
  'Look for quotation marks.',
  'Notice the decimal point.',
  'Its name is the same as what a printer does.',
  'Remember why we wrote float(input(...)) in the perimeter program.',
  'Could you eat the noodles before cooking them?',
  'Picture a flowchart. What is it made of?',
  'Does Python treat a capital N and a small n as the same letter?',
  'A boolean can only ever be one of two values.',
  'Think about the line age = 12. What does it do?',
  'The quotation marks make these text, not numbers.',
  'A question can be answered Yes or No.',
  'Look at the gap between the two words.',
  'print() shows whatever is inside its brackets.',
  'Can a computer run plain English directly?',
  'One has a decimal point and the other does not.',
  'The * sign means multiply. What is 4 × 3?',
  'What must you have before you can boil anything? What is the very last thing you do?',
  'Every algorithm begins with Start, and you cannot calculate before you have the numbers.',
  'You need the score before you can check it, and “Otherwise” always comes after “If”.',
  'Parallelograms are for input and output. The rectangle is for the calculation.',
  'The diamond holds the question. The Yes arrow leads to what happens when the answer is yes.',
  'The length is already entered. What else is needed before calculating? The calculation goes in the rectangle.',
  'Compare the variable name on line 1 with the word used inside print on line 2. Capital letters matter.',
  'Look carefully at which variable the last line prints.',
  'input() gives text. Can you add 1 to text? Which function turns text into a whole number?',
  'You need three lines: read the first number with float(input()), read the second the same way, then print the two variables added together with +.',
];

if (HINTS.length !== CURRENT_EXAM_QUESTIONS.length) {
  throw new Error('Every question in the current exam needs exactly one hint.');
}
CURRENT_EXAM_QUESTIONS.forEach((question, index) => {
  question.hint = HINTS[index];
});
