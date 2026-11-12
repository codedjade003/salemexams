// The JSS1 exam on Scratch (seeded once on first start; edit it afterwards in the admin dashboard).
// 20 simple questions about Scratch, then 5 about blocks. 15 minutes.

export const SCRATCH_EXAM_ID = 'scratch-basics';
export const SCRATCH_EXAM_SEED_KEY = 'seed:scratch-basics:v1';
export const SCRATCH_EXAM_CLASSES = ['JSS1 A', 'JSS1 B', 'JSS1 C', 'JSS1 D'];

export const SCRATCH_EXAM = {
  id: SCRATCH_EXAM_ID,
  title: 'Scratch Basics',
  description: 'For JSS1: simple questions about Scratch and its blocks. 25 questions in 15 minutes.',
  durationSeconds: 15 * 60,
  maxAttempts: 1,
  published: true,
  archived: false,
};

const choice = (text, optionTexts, explanation, hint, extra = {}) => ({
  topic: 'scratch',
  type: 'single',
  format: 'choice',
  text,
  optionTexts,
  correctOptionIds: ['A'], // options are shuffled for every student
  explanation,
  hint,
  ...extra,
});

const pair = (format, text, firstIsCorrect, explanation, hint) => ({
  topic: 'scratch',
  type: 'single',
  format,
  text,
  correctOptionIds: [firstIsCorrect ? 'A' : 'B'],
  explanation,
  hint,
});

// Block questions come after the general ones.
const block = (text, optionTexts, explanation, hint) =>
  choice(text, optionTexts, explanation, hint, { topic: 'scratch-blocks', sectionOrder: 1 });

export const SCRATCH_EXAM_QUESTIONS = [
  // ------------------------------------------------------------- about Scratch (20)
  choice(
    'What is Scratch?',
    [
      'A program for making games, stories and animations with blocks',
      'A program for typing letters',
      'A website for watching videos',
      'A part inside the computer',
    ],
    'Scratch is a coding tool. You join coloured blocks together to make games, stories and animations.',
    'Think about what we made with it in class.'
  ),
  choice(
    'Which animal is the first sprite you see when you open a new Scratch project?',
    ['A cat', 'A dog', 'A bird', 'A fish'],
    'Every new Scratch project starts with the orange Scratch cat.',
    'It is orange and it says “meow”.'
  ),
  choice(
    'In Scratch, what is a sprite?',
    [
      'A character or object that you can make move and talk',
      'The background picture',
      'The button that starts the project',
      'A kind of sound',
    ],
    'A sprite is a character or object in your project, like the cat. You give it blocks to tell it what to do.',
    'The Scratch cat is one of these.'
  ),
  choice(
    'What is the stage in Scratch?',
    [
      'The area where the sprites move and the project plays',
      'The place where blocks are kept',
      'The name of a sprite',
      'The button that saves your work',
    ],
    'The stage is the screen area where you watch your sprites act out the project.',
    'In a theatre, where do the actors perform?'
  ),
  choice(
    'What do you click to start a Scratch project?',
    ['The green flag', 'The red stop sign', 'The cat', 'The backdrop'],
    'Clicking the green flag starts the project.',
    'Green means go.'
  ),
  choice(
    'What does the red stop sign do in Scratch?',
    ['It stops the project', 'It starts the project', 'It deletes the sprite', 'It adds a new sprite'],
    'The red stop sign stops everything that is running.',
    'Red means stop.'
  ),
  choice(
    'How do you make a program in Scratch?',
    [
      'By dragging blocks and joining them together',
      'By drawing with a pencil on paper',
      'By typing a long letter',
      'By shouting at the computer',
    ],
    'In Scratch you drag blocks and snap them together, like a puzzle.',
    'The blocks fit together like puzzle pieces.'
  ),
  choice(
    'A group of blocks joined together is called a…',
    ['Script', 'Sprite', 'Stage', 'Costume'],
    'Blocks joined together make a script. A script tells a sprite what to do, step by step.',
    'It is like the lines an actor follows in a play.'
  ),
  choice(
    'In Scratch, what is a costume?',
    ['A different look for a sprite', 'A sound the sprite makes', 'The background of the stage', 'A way to save your project'],
    'A costume is one of the looks a sprite can have. Changing costumes can make a sprite look like it is moving.',
    'People wear these to look different.'
  ),
  choice(
    'What is a backdrop in Scratch?',
    ['The background picture of the stage', 'A character that moves', 'A block that plays sound', 'The green flag'],
    'A backdrop is the picture behind the sprites, like a beach or a room.',
    'It is at the back of the stage.'
  ),
  choice(
    'Where do you find the blocks in Scratch?',
    ['In the block palette on the left side', 'Inside the stage', 'Inside the green flag', 'On the keyboard'],
    'The blocks are kept in the block palette on the left side of the screen.',
    'Look to the left side of the Scratch screen.'
  ),
  choice(
    'Where do you put blocks so that they can be joined together?',
    ['The script area (code area) in the middle', 'On the stage', 'In the backdrop', 'In the sound list'],
    'You drag blocks from the palette into the script area in the middle and join them there.',
    'It is the big empty space in the middle of the screen.'
  ),
  choice(
    'How are the blocks in Scratch grouped?',
    ['By colour, such as blue for Motion and purple for Looks', 'By size only', 'By the day of the week', 'They are not grouped'],
    'Blocks are grouped by colour. For example, Motion blocks are blue and Looks blocks are purple.',
    'Notice that blocks of the same kind share something you can see.'
  ),
  choice(
    'What can you use the paint editor in Scratch for?',
    ['Drawing or changing sprites and backdrops', 'Sending emails', 'Printing your homework', 'Turning off the computer'],
    'The paint editor lets you draw your own sprites and backdrops or change the ones you have.',
    'Painting is about pictures.'
  ),
  pair(
    'true_false',
    'In Scratch you must type long lines of code to make a sprite move.',
    false,
    'False. In Scratch you join blocks together instead of typing long lines of code.',
    'Do we type or do we drag blocks?'
  ),
  pair(
    'true_false',
    'A Scratch project can have more than one sprite.',
    true,
    'True. You can add as many sprites as your project needs.',
    'Think of a game with a player and an enemy.'
  ),
  pair(
    'true_false',
    'Scratch can be used to make games and animations.',
    true,
    'True. Games, animations and stories are the main things people make with Scratch.',
    'Remember what Scratch is for.'
  ),
  pair(
    'yes_no',
    'Can you add sounds to a Scratch project?',
    true,
    'Yes. Scratch has Sound blocks, and the cat can even say “meow”.',
    'The cat makes a noise.'
  ),
  pair(
    'yes_no',
    'Can a sprite change its costume to look like it is walking?',
    true,
    'Yes. Switching between costumes quickly makes a sprite look like it is walking.',
    'A sprite can have more than one look.'
  ),
  pair(
    'yes_no',
    'Does a sprite do anything if you do not give it any blocks?',
    false,
    'No. A sprite only does what its blocks tell it to do.',
    'A sprite needs instructions.'
  ),

  // ------------------------------------------------------------- blocks (5)
  block(
    'Which of these is a Scratch block?',
    ['move 10 steps', 'print("Hello")', 'Ctrl + C', '<html>'],
    '“move 10 steps” is a blue Motion block in Scratch. The others are not Scratch blocks.',
    'Scratch blocks use simple words that say what the sprite will do.'
  ),
  block(
    'Which block moves a sprite left or right across the stage?',
    ['change x by 10', 'change y by 10', 'say Hello!', 'next costume'],
    '“change x by 10” moves the sprite sideways. Changing y moves it up or down.',
    'x is for left and right. y is for up and down.'
  ),
  block(
    'Which block starts a script when the project begins?',
    ['when green flag clicked', 'forever', 'move 10 steps', 'hide'],
    'The “when green flag clicked” block sits at the top of a script and starts it when you click the green flag.',
    'What do you click to start a project?'
  ),
  block(
    'Which block makes a sprite show a speech bubble with words?',
    ['say Hello! for 2 seconds', 'move 10 steps', 'play sound Meow', 'wait 1 seconds'],
    'The purple “say” block makes a speech bubble appear next to the sprite.',
    'When you talk, you … something.'
  ),
  block(
    'Which block repeats the blocks inside it again and again without stopping?',
    ['forever', 'wait 1 seconds', 'say Hello!', 'when green flag clicked'],
    'The “forever” block keeps repeating whatever is inside it until the project is stopped.',
    'Its name means “without end”.'
  ),
];
