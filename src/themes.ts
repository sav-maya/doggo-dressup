export type Theme = {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
};

export const THEMES: Record<string, Theme> = {
  knight: {
    id: 'knight',
    label: 'Medieval Knight',
    emoji: '⚔️',
    prompt:
      'a heroic medieval knight in shining silver armor with a flowing red cape, holding a tiny sword in their paws, standing in a stone castle courtyard. Oil painting style, dramatic lighting.',
  },
  astronaut: {
    id: 'astronaut',
    label: 'Astronaut',
    emoji: '🚀',
    prompt:
      'a brave astronaut in a NASA-style space suit with a helmet (face still visible through the visor), floating in zero gravity inside the International Space Station with the Earth visible through a porthole. Photorealistic, cinematic.',
  },
  wizard: {
    id: 'wizard',
    label: 'Wizard',
    emoji: '🧙',
    prompt:
      'a wise wizard wearing a starry deep-blue robe and a tall pointed hat, holding a glowing wand, in a magical library full of floating spell books and candles. Fantasy art style, warm magical glow.',
  },
  chef: {
    id: 'chef',
    label: 'Chef',
    emoji: '👨‍🍳',
    prompt:
      'a professional chef wearing a tall white toque and a clean white chef coat, in a bustling restaurant kitchen with steam, copper pots and a flaming pan. Cinematic photo, warm lighting.',
  },
  pirate: {
    id: 'pirate',
    label: 'Pirate Captain',
    emoji: '🏴‍☠️',
    prompt:
      "a swashbuckling pirate captain with a tricorne hat, an eye patch, a gold earring and a red coat, on the wooden deck of a tall ship at sunset with the ocean behind. Adventurous illustrated style.",
  },
  cowboy: {
    id: 'cowboy',
    label: 'Cowboy',
    emoji: '🤠',
    prompt:
      'a cowboy with a wide-brimmed brown hat, leather vest, and red bandana, standing in front of an Arizona desert sunset with saguaro cacti. Vintage western film photo style, golden hour.',
  },
  disco: {
    id: 'disco',
    label: 'Disco Star',
    emoji: '🪩',
    prompt:
      'a 1970s disco dancer in a white sequined jumpsuit and a gold chain, paws raised under a giant spinning disco ball with rainbow lights. Energetic 1970s nightclub photo.',
  },
  sushi: {
    id: 'sushi',
    label: 'Sushi Chef',
    emoji: '🍣',
    prompt:
      'a serious sushi chef wearing a white hachimaki headband and a white chef jacket, behind a clean wooden counter with neatly arranged sushi and a small bonsai. Traditional Japanese photo style.',
  },
};

export const THEME_LIST = Object.values(THEMES);
