// Example prompts shown as one-click starters in the UI. Free-form prompts
// are encouraged — these are just inspiration. The literal "{pet}" token is
// replaced client-side with the user's selected pet's @-mention.

export type Example = {
  id: string;
  emoji: string;
  label: string;
  template: string;
};

export const EXAMPLES: Example[] = [
  {
    id: 'knight',
    emoji: '⚔️',
    label: 'Knight',
    template:
      '{pet} as a heroic medieval knight in shining silver armor with a red cape, in a stone castle courtyard. Oil painting style.',
  },
  {
    id: 'astronaut',
    emoji: '🚀',
    label: 'Astronaut',
    template:
      '{pet} as a NASA astronaut floating in zero gravity inside the ISS, with Earth visible through a porthole. Photorealistic.',
  },
  {
    id: 'wizard',
    emoji: '🧙',
    label: 'Wizard',
    template:
      '{pet} as a wise wizard wearing a starry blue robe and a tall pointed hat, in a magical library full of floating books. Fantasy art style.',
  },
  {
    id: 'chef',
    emoji: '👨‍🍳',
    label: 'Chef',
    template:
      '{pet} as a professional chef in a tall white toque, in a busy restaurant kitchen with copper pots and a flaming pan. Cinematic photo.',
  },
  {
    id: 'pirate',
    emoji: '🏴‍☠️',
    label: 'Pirate',
    template:
      '{pet} as a swashbuckling pirate captain in a tricorne hat and red coat, on the deck of a tall ship at sunset.',
  },
  {
    id: 'cowboy',
    emoji: '🤠',
    label: 'Cowboy',
    template:
      '{pet} as a cowboy in a wide-brimmed hat and red bandana, in front of an Arizona desert sunset. Vintage western photo.',
  },
  {
    id: 'disco',
    emoji: '🪩',
    label: 'Disco',
    template:
      '{pet} as a 1970s disco dancer in a sequined jumpsuit, under a giant spinning disco ball with rainbow lights.',
  },
  {
    id: 'sushi',
    emoji: '🍣',
    label: 'Sushi Chef',
    template:
      '{pet} as a serious sushi chef behind a clean wooden counter with neatly arranged sushi. Traditional Japanese photo style.',
  },
];
