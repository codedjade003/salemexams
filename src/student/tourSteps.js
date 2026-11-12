// Guided tips shown the first time a student opens the exam room.
export const TOUR_STEPS = [
  {
    selector: '.tour-timer',
    dock: 'bottom',
    title: 'Watch the clock',
    text: 'Time left is shown here. It turns amber at 5 minutes and red in the last minute. The exam submits itself at 00:00.',
  },
  {
    selector: '.tour-status',
    dock: 'bottom',
    title: 'Your progress',
    text: 'See how many questions you have answered. Violations (like leaving full screen) are counted here too.',
  },
  {
    selector: '.tour-question',
    dock: 'top',
    title: 'Answer each question',
    text: 'Click an option to choose it. Questions marked “Select all that apply” can have more than one answer.',
  },
  {
    selector: '.tour-palette',
    dock: 'top',
    title: 'Jump between questions',
    text: 'Use the question map to move around. Submit from here when you are done.',
  },
];
