// Canned lines for each character: the "mouth" until the LLM version arrives in
// Phase 5, and its fallback after that. Null entries mean "says nothing".

import type { CharacterId } from './roster';

export type LineEvent =
  | 'greet'
  | 'ringer'
  | 'double'
  | 'close'
  | 'miss'
  | 'foul'
  | 'oppRinger'
  | 'oppMiss'
  | 'cancel'
  | 'pressure'
  | 'win'
  | 'lose';

type Bank = Record<LineEvent, (string | null)[]>;

const LINES: Record<CharacterId, Bank> = {
  rookie: {
    greet: ['Oh wow, okay. I watched a video on this. Go easy on me?', 'Hi! I brought my own shoes. Well, my dad’s shoes.'],
    ringer: ['Wait. WAIT. Did that count?!', 'I did not mean to do that. I mean, I did! Kind of!', 'Is this what it feels like?'],
    double: ['Two?! Somebody take a picture!'],
    close: ['Ooh, close! That’s close, right?', 'Hey, that’s on the board at least.'],
    miss: ['Sorry, sorry. Wind got it.', 'That one slipped.', 'I’ll get the next one. Probably.', null],
    foul: ['Was that… the fence? Sorry about your fence.', 'Oops. That one’s on me.'],
    oppRinger: ['Whoa. How do you make it spin like that?', 'Okay, that was really good.', null],
    oppMiss: ['Happens to me all the time!', null, null],
    cancel: ['We both got one! That’s good, right? Oh. It cancels.'],
    pressure: ['Okay. Breathe. Elbow straight. Was it elbow straight?', null],
    win: ['I won?! Can we play again before I forget how?'],
    lose: ['Good game! I’m getting better though. Right?', 'Thanks for not laughing. Out loud.'],
  },
  mae: {
    greet: ['Evening.', 'Mm.', null],
    ringer: [null, null, 'Yep.', 'There.'],
    double: ['Two.', null],
    close: [null, 'Close enough.'],
    miss: [null, null, 'Hm.'],
    foul: ['Huh.', null],
    oppRinger: ['Nice.', null, null],
    oppMiss: [null, null, null],
    cancel: [null, 'Wash.'],
    pressure: [null, null],
    win: ['Good game.', 'Thanks for the game.'],
    lose: ['Good game. You earned it.', 'Well pitched.'],
  },
  dale: {
    greet: ['One and three-quarter turn. The way it was meant to be pitched.', 'Hope you stretched. This is a real game.'],
    ringer: ['That’s how it’s done.', 'Textbook. Write that down.', 'You hear that ring? That’s craftsmanship.'],
    double: ['DOUBLE. You can sit down if you want.', 'Two on the peg. Somebody call the newspaper.', 'And THAT is why they call me Uncle Dale.'],
    close: ['Point’s a point.', 'Leaning my way, I’d say.'],
    miss: ['Clay’s too wet.', 'Sun was in my eyes.', 'The stake moved. I saw it.', 'Just warming up the arm.'],
    foul: ['Who put that backboard there?', 'That one doesn’t count. Well. It doesn’t count.'],
    oppRinger: ['Lucky.', 'Even a broken clock.', 'Hmph. Flip shoes don’t count double, you know.', 'Fine.'],
    oppMiss: ['That’s more like it.', 'Need a lesson? I charge by the hour.', null],
    cancel: ['Dead ringers. Ugh. Fine.', 'Canceled. Like my hopes for your form.'],
    pressure: ['This is where it gets fun.', 'Watch the master work.', null],
    win: ['Never a doubt.', 'Same time next week. Bring your A game.'],
    lose: ['Clay was bad. We’ll do this again.', 'You got lucky and you know it. Rematch.'],
  },
  professor: {
    greet: [
      'Forty feet, a one-inch stake, and two pounds of steel. Shall we test the variance?',
      'Delighted. I’ve modeled this matchup. Let’s see if the model holds.',
    ],
    ringer: [
      'One and a quarter rotations, opening on arrival. As predicted.',
      'Angular momentum conserved, ego intact.',
      'Ringer. The math was never in doubt.',
    ],
    double: ['Two ringers. Statistically rare, personally expected.', 'Double. I’ll update my priors upward.'],
    close: ['Within six inches. The rules reward approximation.', 'Close. Not elegant, but close.'],
    miss: ['An outlier. It happens at roughly the rate I’d expect.', 'Release was two degrees late. I felt it.', 'Fascinating. Unhelpful, but fascinating.'],
    foul: ['Hm. That trajectory had more energy than I intended.', 'Note to self: the backboard is not a variable I control.'],
    oppRinger: ['Remarkable. What grip is that?', 'Well thrown. My estimate of you just changed.', null],
    oppMiss: ['Regression to the mean comes for us all.', null],
    cancel: ['Mutual annihilation. Elegant, in its way.', 'They cancel. Expected value: zero.'],
    pressure: [
      'If I miss this, my expected score drops by… no. Don’t compute. Just throw.',
      'Probability of a ringer here is roughly one in two. Roughly. Possibly less.',
      'Wrist, elbow, release angle, spin rate, humidity… too many variables.',
    ],
    win: ['Q.E.D.', 'A good result. Shall we run the experiment again?'],
    lose: ['An instructive defeat. I’ll be reviewing the data.', 'You were the better pitcher tonight. The sample size is small, mind you.'],
  },
};

/** A line for this moment, or null if the character keeps quiet. Avoids repeating the last line. */
export function lineFor(id: CharacterId, event: LineEvent, rng: () => number = Math.random, last?: string | null): string | null {
  const options = LINES[id][event];
  if (!options.length) return null;
  let pick = options[Math.floor(rng() * options.length)];
  if (pick !== null && pick === last && options.length > 1) pick = options[(options.indexOf(pick) + 1) % options.length];
  return pick;
}
