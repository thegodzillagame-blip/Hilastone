// Hilastone card definitions + targeting rules.
// CARDS and LANES come from the original working file (unedited).
// TARGETING_RULES is new — built from the card text + the rulings in HANDOFF.md.
const CARDS = [{"name": "Aegon", "pronouns": "It/They", "hp": 14, "cost": 2, "passiveName": "Soul Siphon", "passive": "This character gains 2 HP for every character it defeats.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 4 Damage to a single target.", "a3": "Deal 8 Damage to every card in the opposing lane."}, {"name": "Aichmo", "pronouns": "She/Her", "hp": 11, "cost": 4, "passiveName": "Knife Trick", "passive": "If there are any allies in this lane, this card deals 2 more Damage. Does not stack.", "a1": "Deal 1 Damage to a single target.", "a2": "Deal 2 Damage to every card in the opposing lane.", "a3": "By your next turn, deal 4 extra Damage with the first attack of the turn."}, {"name": "A.L.I.C.E.", "pronouns": "She/They/It", "hp": 14, "cost": 4, "passiveName": "Order in the Court", "passive": "When this character is placed, the opponent cannot summon any characters in the lane on their next turn.", "a1": "Move to a different lane.", "a2": "Deal 5 Damage to a single target.", "a3": "Deal 8 Damage to every card in the lane, regardless friend or foe, not including self."}, {"name": "Andromeda", "pronouns": "She/Her", "hp": 10, "cost": 5, "passiveName": "Referendum", "passive": "Double any Damage or HP boosts within the lane.", "a1": "Move to a different lane.", "a2": "Deal 4 Damage to a single target.", "a3": "Deal 4 Damage to every card in the opposing lane. This attack does 3 extra damage for every opposing card in the lane. Damage boosts only affect the first attack."}, {"name": "Arlukino", "pronouns": "They/Them", "hp": 6, "cost": 5, "passiveName": "Overshadow", "passive": "This character is free when any character is defeated, friend or foe.", "a1": "Move to a different lane.", "a2": "Deal 4 damage to a single target, regardless of lane.", "a3": "Move a card in the opposing lane to a different lane."}, {"name": "Astaroth", "pronouns": "He/Him", "hp": 16, "cost": 3, "passiveName": "Too Hot to Handle", "passive": "Any damage dealt to this character damages the attacker as well for half of the Damage.", "a1": "Deal 1 extra Damage on this character's next attack. Stacks between turns.", "a2": "Deal 6 damage to a single target in the lane.", "a3": "Halve all incoming Damage towards this character. This effect is removed by your next turn. Does not affect Passive Ability."}, {"name": "Audrey", "pronouns": "She/Her", "hp": 4, "cost": 2, "passiveName": "Tiny Tot", "passive": "This character cannot be damaged by multi-target attacks.", "a1": "Grant 1 HP to an ally.", "a2": "Gain 1 HP. HP cannot exceed 4.", "a3": "Grant 4 HP to an ally within the lane, not including self."}, {"name": "Baelia", "pronouns": "It/Its", "hp": 10, "cost": 3, "passiveName": "Static Electricity", "passive": "Any single-target Damage to this character damages the attacker as well.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 4 Damage to every card in the opposing lane.", "a3": "Negate all damage towards this character. This effect is removed by your next turn."}, {"name": "Blitzmarsch", "pronouns": "She/Her", "hp": 10, "cost": 4, "passiveName": "Headstart", "passive": "Add the amount of cards in your hand to HP.", "a1": "Flip a coin. If Heads, deal 4 Damage to a single target.", "a2": "Roll a D6. Deal the outcome in damage to a single target.", "a3": "Roll a D20. Deal the outcome in damage to a single target, regardless of lane."}, {"name": "Calamity", "pronouns": "She/It", "hp": 9, "cost": 3, "passiveName": "Stealth 100", "passive": "This character can only be damaged by multi-target attacks.", "a1": "Move to a different lane.", "a2": "Deal 4 Damage to a single target, regardless of lane.", "a3": "Calamity will take damage instead of an intended ally. The effect is removed by your next turn."}, {"name": "Carmella", "pronouns": "She/Her", "hp": 6, "cost": 3, "passiveName": "Too Cold to Hold", "passive": "No characters can be summoned to the same lane as this character. This Ability affects all players.", "a1": "Move to a different lane.", "a2": "Move an ally to a different lane.", "a3": "At the end of the opponent's next turn, deal 10 damage to all cards in the opposing lane."}, {"name": "Chamorie", "pronouns": "She/They", "hp": 8, "cost": 2, "passiveName": "Got a Quarter?", "passive": "Every turn, while this character is active, flip a coin. If heads, gain 2 bonus Energy for this turn. If tails, this character deals 2 extra Damage for the turn.", "a1": "Deal 1 Damage to a single target, regardless of lane.", "a2": "Deal 3 Damage to all opposing cards in any lane.", "a3": "Reactivate the passive ability. Stacks with the original outcome, but is removed by your next turn."}, {"name": "Chloe", "pronouns": "She/They/It", "hp": 10, "cost": 2, "passiveName": "Venting", "passive": "Deal 2 extra Damage for every opposing card in the lane.", "a1": "Deal 1 Damage to a single target.", "a2": "Move to a different lane.", "a3": "Deal 5 Damage to all opposing cards in the lane."}, {"name": "Cinwicke", "pronouns": "She/Her", "hp": 3, "cost": 2, "passiveName": "Ghostiness", "passive": "This character can only receive 1 Damage per turn.", "a1": "Move to a different lane.", "a2": "Deal 2 Damage to a single target.", "a3": "Apply this card's Passive Ability to an ally in the lane. This effect is removed by your next turn."}, {"name": "Cordelia", "pronouns": "She/Her", "hp": 6, "cost": 3, "passiveName": "Lab Rat", "passive": "While this character is active, one character can be summoned for free per turn.", "a1": "Move an ally to this lane.", "a2": "Deal 2 Damage to a single target.", "a3": "Summon a character for free. Defeat this card."}, {"name": "Crumbs", "pronouns": "They/Them", "hp": 6, "cost": 4, "passiveName": "Faceless", "passive": "Copy the ability of an active ally within the lane. One copy per turn.", "a1": "Deal 2 Damage to a single target.", "a2": "Prevent a single target from performing actions for one turn.", "a3": "Move to a different lane. If there is one or no opposing cards in the destination, this action is free."}, {"name": "Delici", "pronouns": "She/Her", "hp": 8, "cost": 3, "passiveName": "Explosive Magic", "passive": "All damage dealt with this card deals half the damage to adjacent lanes.", "a1": "Deal 2 extra Damage for this character's next attack. Does not stack between turns.", "a2": "Deal 4 Damage to all cards in the lane, friend or foe, not including self.", "a3": "Apply this card's Passive Ability to an ally. This effect is removed by your next turn."}, {"name": "Domi", "pronouns": "She/Her", "hp": 8, "cost": 3, "passiveName": "Concrete Shoes", "passive": "Opposing characters within this character's lane cannot move or be moved.", "a1": "Gain 1 HP. Bonus HP granted from this action is removed by your next turn.", "a2": "Deal 4 Damage to a single target.", "a3": "View your opponent's hand. Increase the energy cost of any character in their hand by 2."}, {"name": "Ellie Ember", "pronouns": "She/Her", "hp": 6, "cost": 1, "passiveName": "Charmin' \"Li'l\" Toon", "passive": "No characters except for this one can perform actions in the lane this character is active in.", "a1": "Grant 1 HP to an ally.", "a2": "Deal 1 Damage to a single target.", "a3": "Move to a different lane. If there is at least one other card in the designation, this action is free."}, {"name": "Gunpowder", "pronouns": "She/Her", "hp": 8, "cost": 2, "passiveName": "Sisters!", "passive": "Deals 2 extra Damage if Propane is active on the board, and 4 extra damage if Propane is in the same lane.", "a1": "Deal 1 Damage to a single target.", "a2": "Deal 4 Damage to all cards in the opposing lane.", "a3": "Move to a different lane. If Propane is in the designated lane, this action is free and gains 2 HP."}, {"name": "Halcyon", "pronouns": "It/They", "hp": 10, "cost": 3, "passiveName": "Tactical Retreat", "passive": "This character cannot be prevented from moving lanes. Gain 1 HP every time this character moves lanes.", "a1": "Deal 1 Damage to a single target.", "a2": "Move to a different lane.", "a3": "Move all allies to this lane."}, {"name": "Hyperion", "pronouns": "It/They", "hp": 14, "cost": 3, "passiveName": "Shock Absorption", "passive": "Single-target damage to this character grants 2 bonus Damage to its attacks.", "a1": "Deal 1 Damage to self.", "a2": "Deal 2 Damage to a single target.", "a3": "Deal 8 Damage to all opposing cards. Deal 4 Damage to self."}, {"name": "Ilynn", "pronouns": "She/Her", "hp": 8, "cost": 3, "passiveName": "Waning Candle", "passive": "Every turn, grant 2 bonus Energy, but deal 1 Damage to self.", "a1": "Grant 1 bonus Damage to any next attack.", "a2": "Deal 2 Damage to all cards in the opposing lane.", "a3": "Negate the Passive Ability of any active card in the lane for one turn."}, {"name": "Iridia", "pronouns": "She/Her", "hp": 12, "cost": 3, "passiveName": "Immolation", "passive": "When this character is defeated, deal 10 Damage to all cards in the lane, friend or foe.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 5 Damage to all cards in the opposing lane.", "a3": "Move to a different lane. If there are no ally cards in the lane, deal 6 Damage to all cards in the opposing lane."}, {"name": "Kazura", "pronouns": "She/Her", "hp": 8, "cost": 4, "passiveName": "Flower Breathing", "passive": "Once per turn, negate an attack directed towards this character. If this character is attacked, the attacker receives the Damage as well.", "a1": "Deal 3 Damage towards a single target.", "a2": "Deal 1 Damage for every HP this character is missing towards a single target.", "a3": "Move an opposing card to a different lane. Then, disable their actions for one turn."}, {"name": "Kirine", "pronouns": "She/It", "hp": 12, "cost": 3, "passiveName": "Quickstep", "passive": "When this character moves, its next attack is free and deals double damage. Does not stack. Does not apply if this character is moved.", "a1": "Grant 1 bonus Damage for this character's next attack. Stacks between turns.", "a2": "Deal 4 Damage to a single target.", "a3": "Move to a different lane."}, {"name": "Lilith", "pronouns": "She/Her", "hp": 14, "cost": 3, "passiveName": "Siren of the Inky Seas", "passive": "Grants 2 bonus Energy if there are no characters in this character's lane, friend or foe.", "a1": "Deal 2 damage to a single target.", "a2": "Gain 2 HP. HP cannot exceed 10.", "a3": "Deal 5 Damage to all cards in the opposing lane."}, {"name": "Lily", "pronouns": "She/Her", "hp": 10, "cost": 3, "passiveName": "Getting the Drop", "passive": "When this character moves, deal 2 Damage to all cards in the opposing lane. Does not apply if moved.", "a1": "Deal 1 Damage to a single target.", "a2": "Prevent a single target from performing actions for one turn.", "a3": "Move to a different lane. If there is one or no opposing cards in the destination, this action is free."}, {"name": "Linnaeus", "pronouns": "He/It", "hp": 4, "cost": 3, "passiveName": "Parasitism", "passive": "Deals 3 extra Damage if Piper is in the same lane. Defeated when Piper is defeated. Cannot be summoned if Piper cannot be summoned. Considered defeated if Piper is unusable.", "a1": "If Piper is active, move to her lane.", "a2": "Deal 12 Damage to a single target.", "a3": "Move an opposing card to a different lane.", "requires": "Piper"}, {"name": "Lucia", "pronouns": "Any", "hp": 13, "cost": 5, "passiveName": "You Can't Cheat Death", "passive": "This character can only be defeated with an attack that will result in exactly 0 HP.", "a1": "Move to a different lane.", "a2": "Deal 6 Damage to a single target. If fatal, gain 1 bonus Energy.", "a3": "Instantly destroy 1 opposing card, regardless of lane. This action can only be performed once per turn."}, {"name": "Margerine", "pronouns": "She/Her", "hp": 8, "cost": 3, "passiveName": "Squash n' Stretch", "passive": "This character can only take 2 Damage per opposing attack.", "a1": "Grant 2 extra Damage to this character's next attack. Stacks between turns.", "a2": "Deal 6 Damage to a single target.", "a3": "Deal 12 Damage to all cards on the opposing lane. Deal 8 Damage to all cards in your lane."}, {"name": "Maxine", "pronouns": "She/Her", "hp": 12, "cost": 2, "passiveName": "Sour, Sweet, Gone", "passive": "When this character is attacked, deal 3 Damage to the attacker, then move to a different lane.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 6 Damage to a single target.", "a3": "Prevent the opposing lane from performing actions for one turn. Deal 2 Damage to self."}, {"name": "Miasma", "pronouns": "She/They/It", "hp": 14, "cost": 3, "passiveName": "Biohazard", "passive": "This character grants 1 bonus Energy for every character it defeats.", "a1": "Deal 1 Damage to a single target. By your next turn, deal 1 Damage to that target.", "a2": "Deal 7 Damage to a single target.", "a3": "Deal 5 Damage to all cards on any opposing lane. By your next turn, deal 5 Damage to all cards in that lane."}, {"name": "Miles", "pronouns": "He/It", "hp": 6, "cost": 4, "passiveName": "HEY GUYS WHAT DID I MISS", "passive": "If this character is defeated, revive it and move it to a different lane. Only works once.", "a1": "Deal 1 Damage to all cards on the opposing lane.", "a2": "Deal 4 Damage to a single target.", "a3": "Grant all allies 8 HP. Defeat this card."}, {"name": "Mirette", "pronouns": "She/Her", "hp": 8, "cost": 2, "passiveName": "Thinking With Portals", "passive": "If this character is attacked, move to a different lane. When this character moves or is moved, its next attack deals double damage.", "a1": "Move to a different lane.", "a2": "Deal 4 Damage to a single target.", "a3": "Prevent any damage towards this character once. The effect is removed by your next turn."}, {"name": "Orina", "pronouns": "She/Her", "hp": 8, "cost": 4, "passiveName": "Violent Escapism", "passive": "This character deals 1 bonus Damage for every card in the lane, friend or foe.", "a1": "Grant 1 bonus Damage for this character's next attack. Does not stack between turns.", "a2": "Deal 8 Damage to a single target.", "a3": "Deal 4 Damage to all cards in the opposing lane. If fatal, gain 1 HP."}, {"name": "Peggy", "pronouns": "She/They", "hp": 2, "cost": 4, "passiveName": "Band... Together!", "passive": "This character can't be damaged if there are three other ally cards in the lane.", "a1": "Grant 1 HP to all allies in the lane. The bonus HP granted from this action is removed by your next turn.", "a2": "Grant 3 bonus Damage to all allies in the lane.", "a3": "Adds together the HP values of every ally in the lane and deals that number in Damage to all cards in the opposing lane.", "banished": true}, {"name": "Piper", "pronouns": "She/Her", "hp": 12, "cost": 3, "passiveName": "Lovely Host", "passive": "If Linnaeus is in your hand, summon him for free.", "a1": "Gain 2 HP. The bonus HP granted from this action is removed by your next turn.", "a2": "Deal 6 Damage to a single target.", "a3": "Grant 2 HP to all allies in the lane, including self. / Grant Linnaeus double damage for the turn."}, {"name": "Postman Mortem", "pronouns": "", "hp": 1, "cost": 1, "passiveName": "Deliver Us from Evil!", "passive": "When this character is defeated, summon a card for free.", "a1": "Move to a different lane.", "a2": "Deal 1 damage to a single target.", "a3": "Summon a card for free."}, {"name": "Propane", "pronouns": "", "hp": 10, "cost": 2, "passiveName": "Sisters!", "passive": "Deals 2 extra Damage if Gunpowder is active on the board, and 4 extra damage if Gunpowder is in the same lane.", "a1": "Move Gunpowder or Propane to a different lane.", "a2": "Deal 6 Damage to all cards on the opposing lane.", "a3": "Propane will take damage instead of an intended ally. Only works for single-target attacks. The effect is removed by your next turn."}, {"name": "Rannivieve von Rimmett", "pronouns": "", "hp": 12, "cost": 3, "passiveName": "Bolted Down", "passive": "Cannot be moved.", "a1": "Deal 2 Damage to a single target, regardless of lane.", "a2": "Deal 5 Damage to all cards on any opposing lane.", "a3": "Gain 8 HP."}, {"name": "Red", "pronouns": "He/Him", "hp": 12, "cost": 3, "passiveName": "It's Showtime!", "passive": "This character grants 3 bonus Energy if it moves to a lane with at least 1 other character active. Works once per turn.", "a1": "Deal 2 Damage to a single target.", "a2": "Prevent a single target from performing actions for one turn.", "a3": "Move to a different lane. If there is one or no opposing cards in the destination, this action is free."}, {"name": "Reishi", "pronouns": "She/They", "hp": 7, "cost": 3, "passiveName": "THE SPORES", "passive": "Once per turn, flip a coin. If heads, this character's next action is free.", "a1": "By your next turn, grant 1 bonus Damage to this character's next attack. Stacks between turns.", "a2": "By your next turn, deal 4 Damage to all cards in the opposing lane.", "a3": "Move to a different lane. If there are no cards in the destination, this action is free."}, {"name": "Remington", "pronouns": "He/They/It", "hp": 14, "cost": 4, "passiveName": "Maraud", "passive": "When attacking a character with a single-target attack, move it to a different lane. If there are other opposing cards in that lane, deal 4 Damage to all opposing cards in that lane.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 4 Damage to all cards on the opposing lane.", "a3": "Gain 2 HP."}, {"name": "Ridley", "pronouns": "They/Them", "hp": 6, "cost": 2, "passiveName": "Turtle Shell", "passive": "This character can only be damaged once per turn.", "a1": "Gain 1 HP. This effect is removed by your next turn.", "a2": "Deal 5 Damage to a single target.", "a3": "Move to a different lane."}, {"name": "Rios", "pronouns": "He/Him", "hp": 12, "cost": 4, "passiveName": "Bloodshed", "passive": "This character gains 2 HP every time it lands a successful attack.", "a1": "Deal 3 Damage to a single target. Deal 1 Damage to self.", "a2": "Deal 8 Damage to a single target. Deal 4 Damage to self. If fatal to either, grant 2 bonus Energy.", "a3": "Deal 8 Damage to all cards in the opposing lane. Defeat this card."}, {"name": "Selene", "pronouns": "She/Her", "hp": 10, "cost": 4, "passiveName": "Healing Aura", "passive": "Grant 2 HP for all allies in the lane, not including self.", "a1": "Gain 2 HP. This effect is removed by your next turn.", "a2": "Deal 2 Damage to a single target.", "a3": "Move an ally to this lane."}, {"name": "The Shadow", "pronouns": "He/They/It", "hp": 10, "cost": 5, "passiveName": "happiness is never ending", "passive": "This character grants 3 bonus Energy if it moves or is moved to a lane with no other characters active.", "a1": "Deal 3 Damage to a single target.", "a2": "Prevent all cards in the opposing lane from performing actions for one turn.", "a3": "Take a card from your opponent's hand and add them to your hand. Only works once."}, {"name": "Shelby", "pronouns": "She/They/It", "hp": 12, "cost": 4, "passiveName": "The Hunger", "passive": "When you end a turn with 0 Energy remaining, this character's next action deals double damage.", "a1": "Deal 2 Damage to a single target.", "a2": "Deal 6 Damage to a single target.", "a3": "Deal double damage for this character's next attack. Does not stack between turns."}, {"name": "Suraimu", "pronouns": "Any", "hp": 4, "cost": 3, "passiveName": "Slippery", "passive": "If this character is attacked, flip a coin. If Heads, the damage is negated.", "a1": "Move to a different lane.", "a2": "Copy the attack of any active ally character in the lane.", "a3": "Suraimu will take damage instead of an intended ally. Only works for single-target attacks. The effect is removed by your next turn."}, {"name": "Syrah Ros\u00e9", "pronouns": "She/They/It", "hp": 14, "cost": 5, "passiveName": "Shocking Presence", "passive": "Every turn, deal 4 Damage to all cards in the opposing lane.", "a1": "Deal 3 Damage to a single target. Deal 1 Damage to self.", "a2": "Deal 8 Damage to all cards in the opposing lane. Deal 4 Damage to self.", "a3": "Move to a different lane. Deal 10 Damage to all cards in that lane, friend or foe, including self."}, {"name": "Tanker", "pronouns": "She/Her", "hp": 12, "cost": 4, "passiveName": "Transform", "passive": "Spend 1 Energy to switch between Robot and Tank mode, changing movesets. Bonuses are removed when switching forms. Starts in Robot Mode.", "a1": "Robot: Gain 1 bonus Damage for this character's next attack. Stacks between turns. / Tank: Gain 1 HP. The bonus HP is removed by your next turn.", "a2": "Robot: Deal 4 Damage to a single target. / Tank: Move to a different space.", "a3": "Deal damage equal to this character's HP to all cards in the opposing lane."}, {"name": "Venia", "pronouns": "She/Her", "hp": 10, "cost": 4, "passiveName": "Filicide", "passive": "When you place this character, instantly defeat one opposing card. Then, instantly defeat an ally card.", "a1": "Move to a different lane.", "a2": "Deal 4 Damage to a single target. Gain 2 HP.", "a3": "Deal 12 Damage to all cards in an opposing lane. By your next turn, deal 12 Damage to that lane."}, {"name": "Vincent", "pronouns": "He/Him", "hp": 12, "cost": 3, "passiveName": "I'll Get You Back", "passive": "Any single-target Damage towards this character grants them 3 bonus Damage for its next attack.", "a1": "Gain 1 bonus damage for this character's next attack. Does not stack between turns.", "a2": "Deal 6 Damage to a single target.", "a3": "Deal 4 Damage to a single target. If fatal, this character's next attack deals double damage."}, {"name": "Vivian", "pronouns": "She/Her", "hp": 10, "cost": 5, "passiveName": "Gold Standard", "passive": "When you end a turn with 0 Energy, this character's next action is free.", "a1": "Gain 1 HP. HP cannot exceed 12.", "a2": "Grant 3 HP to an ally.", "a3": "Deal damage equal to this character's HP to a single target. If fatal, this action is free."}, {"name": "Wheelie", "pronouns": "She/They", "hp": 5, "cost": 3, "passiveName": "Comedic Timing", "passive": "Every turn, roll a D6. If the result is 6, this character negates all damage towards it. If the result is 1, defeat this card.", "a1": "Deal 1 Damage to a single target.", "a2": "Move an ally to a different lane.", "a3": "Flip a coin. If heads, instantly defeat one opposing card."}, {"name": "Yukiko", "pronouns": "She/Her", "hp": 8, "cost": 3, "passiveName": "Drillbit, Awayyy!", "passive": "This character can prevent a target from performing actions when the character moves. Does not apply when it is moved.", "a1": "Deal 2 damage to a single target.", "a2": "Move to a different lane.", "a3": "Deal 20 Damage to all cards in the opposing lane who are disabled in any way."}, {"name": "Yure", "pronouns": "She/They/It", "hp": 4, "cost": 2, "passiveName": "Cold Case Unburied", "passive": "When this character gets defeated, summon a card for free.", "a1": "Move to a different lane.", "a2": "Prevent a single target from performing actions for one turn.", "a3": "Move to a different lane. Then, move any card to this designation, friend or foe."}];

const LANES = ["Left", "Center", "Right"];
const LANE_CAP = 4;

// Which lanes are adjacent to which. Left<->Center and Center<->Right are
// adjacent; Left<->Right is NOT (per HANDOFF ruling #4).
const ADJACENT_LANES = { Left: ["Center"], Center: ["Left", "Right"], Right: ["Center"] };

// ---- Targeting rule schema (per HANDOFF.md) ----
// mode: "single" | "all" | "move" | "capacity-multi" | "none" | "self"
//   single   -> tap one valid unit on the board
//   all      -> tap any unit in the desired lane to confirm it (or the lane
//               itself, if scope is same-lane the lane is already implied
//               by the acting unit's own lane and needs no tap)
//   move     -> the ACTING unit relocates (side:"self"), or this unit moves
//               a DIFFERENT unit (side:"ally"/"opponent" - two-step: pick
//               unit, then pick destination lane)
//   capacity-multi -> repeatedly pick allies to pull into the acting lane,
//               stopping at LANE_CAP (Halcyon A3 style)
//   none     -> no target needed; effect is a self-buff/delayed/manual
//               interaction the player applies by hand. `note` explains it.
//   self     -> simple immediate self-effect (e.g. "Gain 1 HP"), no target,
//               no extra explanation needed beyond the card text.
// side: "ally" | "opponent" | "both" (only meaningful for single/all/move)
// scope: "same-lane" | "any-lane"
// excludesSelf: true if the acting unit itself should be excluded from an
//   "all"/"both" target list
// note: free text — flags coin/dice rolls, delayed/echo effects, synergy
//   bonuses, or scope ambiguities the player should apply manually
// requiresOverride: true on a handful of entries where the printed card
//   text doesn't give the engine enough to compute a value automatically
//   (e.g. damage = own HP); the player applies the number by hand using
//   the existing HP/damage controls — this flag is informational only.

const TARGETING_RULES = {
  "Aegon": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "same-lane" }
  },
  "Aichmo": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "By next turn, this character's first attack of the turn deals +4 damage. Apply manually when that attack lands." }
  },
  "A.L.I.C.E.": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "both", scope: "same-lane", excludesSelf: true }
  },
  "Andromeda": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "+3 dmg per opposing card already in the lane (first attack only) — add that bonus by hand." }
  },
  "Arlukino": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "any-lane" },
    a3: { mode: "move", side: "opponent", scope: "any-lane", note: "Pick an opposing card, then pick its new lane." }
  },
  "Astaroth": {
    a1: { mode: "none", note: "Self buff: +1 damage on this character's next attack. Stacks between turns." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Self buff: halve all incoming damage until your next turn." }
  },
  "Audrey": {
    a1: { mode: "single", side: "ally", scope: "same-lane", note: "Scope unresolved in HANDOFF — defaulting to same-lane until confirmed." },
    a2: { mode: "self" },
    a3: { mode: "single", side: "ally", scope: "same-lane", excludesSelf: true }
  },
  "Baelia": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Self buff: negate all incoming damage until your next turn." }
  },
  "Blitzmarsch": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "coin: flip first — Heads only." },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "D6: roll for damage amount." },
    a3: { mode: "single", side: "opponent", scope: "any-lane", note: "D20: roll for damage amount." }
  },
  "Calamity": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "any-lane" },
    a3: { mode: "none", note: "Self redirect: Calamity intercepts damage meant for an ally until your next turn." }
  },
  "Carmella": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "move", side: "ally", scope: "any-lane", note: "Moves a DIFFERENT ally — pick the ally, then its destination." },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "Delayed: triggers at the end of the opponent's next turn." }
  },
  "Chamorie": {
    a1: { mode: "single", side: "opponent", scope: "any-lane" },
    a2: { mode: "all", side: "opponent", scope: "any-lane" },
    a3: { mode: "none", note: "Self: re-trigger the passive coin flip; stacks, removed by your next turn." }
  },
  "Chloe": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "move", side: "self", scope: "adjacent" },
    a3: { mode: "all", side: "opponent", scope: "same-lane" }
  },
  "Cinwicke": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "single", side: "ally", scope: "same-lane", note: "Applies this card's passive to the chosen ally until your next turn." }
  },
  "Cordelia": {
    a1: { mode: "move", side: "ally", scope: "any-lane", note: "Pulls an ally INTO Cordelia's lane — edge case flagged in HANDOFF." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Opens free-summon picker, then defeats this card." }
  },
  "Crumbs": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Disables the target for one turn." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free if the destination has 0-1 opposing cards." }
  },
  "Delici": {
    a1: { mode: "none", note: "Self buff: +2 damage on next attack. Does not stack." },
    a2: { mode: "all", side: "both", scope: "same-lane", excludesSelf: true },
    a3: { mode: "single", side: "ally", scope: "same-lane", note: "Applies this card's passive to the chosen ally until your next turn." }
  },
  "Domi": {
    a1: { mode: "self", note: "Bonus HP is removed by your next turn." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "View opponent's hand, raise one card's cost by 2 — manual hand interaction." }
  },
  "Ellie Ember": {
    a1: { mode: "single", side: "ally", scope: "same-lane", note: "Scope unresolved in HANDOFF — defaulting to same-lane until confirmed." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free if the destination already has at least one other card." }
  },
  "Gunpowder": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "Sisters! +2 dmg if Propane is active anywhere, +4 dmg if in the same lane (tiered, stacks)." },
    a2: { mode: "all", side: "opponent", scope: "same-lane", note: "Sisters! +2 dmg if Propane is active anywhere, +4 dmg if in the same lane (tiered, stacks)." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free + gain 2 HP if Propane is in the destination lane." }
  },
  "Halcyon": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "move", side: "self", scope: "adjacent" },
    a3: { mode: "capacity-multi", side: "ally", scope: "any-lane", note: "Move ALL allies into this lane, capped at LANE_CAP — pick them one at a time." }
  },
  "Hyperion": {
    a1: { mode: "self", note: "Self-damage: 1 damage to self." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "Also deals 4 damage to self." }
  },
  "Ilynn": {
    a1: { mode: "single", side: "both", scope: "any-lane", note: "Grant bonus damage to any unit's next attack — ally or self, any lane." },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "single", side: "both", scope: "same-lane", note: "Negates the passive of any active card (ally or foe) in the lane for one turn." }
  },
  "Iridia": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "If no allies remain in the old lane after moving, also deal 6 dmg to all cards in the new opposing lane — check and apply by hand." }
  },
  "Kazura": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Damage = HP Kazura is currently missing — calculate and apply by hand." },
    a3: { mode: "move", side: "opponent", scope: "any-lane", note: "Pick an opposing card, move it, then it's disabled for one turn." }
  },
  "Kirine": {
    a1: { mode: "none", note: "Self buff: +1 damage on next attack. Stacks between turns." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "self", scope: "adjacent" }
  },
  "Lilith": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "self" },
    a3: { mode: "all", side: "opponent", scope: "same-lane" }
  },
  "Lily": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Disables the target for one turn." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free if the destination has 0-1 opposing cards." }
  },
  "Linnaeus": {
    a1: { mode: "move", side: "self", scope: "any-lane", note: "Only usable if Piper is active — moves directly to Piper's lane." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "opponent", scope: "any-lane" }
  },
  "Lucia": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "If fatal, gain 1 bonus Energy." },
    a3: { mode: "single", side: "opponent", scope: "any-lane", note: "Instant destroy — once per turn." }
  },
  "Margerine": {
    a1: { mode: "none", note: "Self buff: +2 damage on next attack. Stacks between turns." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "both", scope: "same-lane", note: "12 dmg to the opposing lane AND 8 dmg to your own lane (two separate hits)." }
  },
  "Maxine": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Disables the opposing lane for one turn; also deals 2 damage to self." }
  },
  "Miasma": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "Echo: deal 1 more damage to the same target by your next turn." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "any-lane", note: "Echo: repeat the 5 damage to that same lane by your next turn." }
  },
  "Miles": {
    a1: { mode: "all", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Grants ALL allies (full board) 8 HP, then defeats this card." }
  },
  "Mirette": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Self buff: negate the next instance of damage. Removed by your next turn." }
  },
  "Orina": {
    a1: { mode: "none", note: "Self buff: +1 damage on next attack. Does not stack." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "If fatal, gain 1 HP." }
  },
  "Peggy": {
    a1: { mode: "all", side: "ally", scope: "same-lane", note: "Bonus HP is removed by your next turn." },
    a2: { mode: "all", side: "ally", scope: "same-lane" },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "Damage = sum of every ally's HP in this lane — total it and apply by hand." }
  },
  "Piper": {
    a1: { mode: "self", note: "Bonus HP is removed by your next turn." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "all", side: "ally", scope: "same-lane", note: "Grants 2 HP to all allies in the lane (incl. self) AND separately grants Linnaeus double damage for the turn (no lane restriction on that part)." }
  },
  "Postman Mortem": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Opens the free-summon picker." }
  },
  "Propane": {
    a1: { mode: "move", side: "ally", scope: "adjacent", note: "Moves Gunpowder or Propane (whichever is on the board) to a different lane." },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Self redirect: Propane intercepts single-target damage meant for an ally until your next turn." }
  },
  "Rannivieve von Rimmett": {
    a1: { mode: "single", side: "opponent", scope: "any-lane" },
    a2: { mode: "all", side: "opponent", scope: "any-lane" },
    a3: { mode: "self" }
  },
  "Red": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Disables the target for one turn." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free if the destination has 0-1 opposing cards." }
  },
  "Reishi": {
    a1: { mode: "none", note: "Echo: by your next turn, +1 damage to this character's next attack. Stacks." },
    a2: { mode: "all", side: "opponent", scope: "same-lane", note: "Echo: applies by your next turn, not immediately." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Free if the destination has no cards at all." }
  },
  "Remington": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "Passive then moves the target to a different lane; if other opposing cards are there, deal 4 dmg to all of them — apply by hand." },
    a2: { mode: "all", side: "opponent", scope: "same-lane" },
    a3: { mode: "self" }
  },
  "Ridley": {
    a1: { mode: "self", note: "Removed by your next turn." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "self", scope: "adjacent" }
  },
  "Rios": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "Also deals 1 damage to self." },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Also deals 4 damage to self. If fatal to either, grant 2 bonus Energy." },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "Then defeats this card." }
  },
  "Selene": {
    a1: { mode: "self", note: "Removed by your next turn." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "move", side: "ally", scope: "any-lane", note: "Pulls an ally INTO Selene's lane — edge case flagged in HANDOFF." }
  },
  "The Shadow": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "all", side: "opponent", scope: "same-lane", note: "Disables every card in that lane for one turn (no damage)." },
    a3: { mode: "none", note: "Steal a card from the opponent's hand. Only works once — manual hand interaction." }
  },
  "Shelby": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "none", note: "Self buff: double damage on next attack. Does not stack." }
  },
  "Suraimu": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Copies an active ally's attack — pick the ally to copy first, then the target." },
    a3: { mode: "none", note: "Self redirect: Suraimu intercepts single-target damage meant for an ally. Removed by your next turn." }
  },
  "Syrah Rosé": {
    a1: { mode: "single", side: "opponent", scope: "same-lane", note: "Also deals 1 damage to self." },
    a2: { mode: "all", side: "opponent", scope: "same-lane", note: "Damage = this character's own HP (verified ruling, overrides printed flat number). Also deals 4 damage to self.", requiresOverride: true },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Damage = this character's own HP (verified ruling). After moving, deals that to all cards in the destination lane, friend or foe, including self.", requiresOverride: true }
  },
  "Tanker": {
    a1: { mode: "none", formSplit: true, note: "Robot: +1 dmg next attack (stacks). Tank: +1 HP (removed next turn)." },
    a2: { mode: "single", side: "opponent", scope: "same-lane", formSplit: true, note: "Robot: deal 4 dmg to a single target. Tank: this is a MOVE action instead (move to a different lane)." },
    a3: { mode: "all", side: "opponent", scope: "same-lane", formSplit: false, damageSource: "self-current-hp", note: "CONFIRMED not form-split — same in both forms (verified against a match log). Damage = this character's own HP." }
  },
  "Venia": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Also gain 2 HP." },
    a3: { mode: "all", side: "opponent", scope: "any-lane", note: "Echo: repeat the 12 damage to that same lane by your next turn." }
  },
  "Vincent": {
    a1: { mode: "none", note: "Self buff: +1 damage on next attack. Does not stack." },
    a2: { mode: "single", side: "opponent", scope: "same-lane" },
    a3: { mode: "single", side: "opponent", scope: "same-lane", note: "If fatal, this character's next attack deals double damage." }
  },
  "Vivian": {
    a1: { mode: "self", note: "HP cannot exceed 12." },
    a2: { mode: "single", side: "ally", scope: "same-lane", note: "Scope unresolved in HANDOFF — defaulting to same-lane until confirmed." },
    a3: { mode: "single", side: "opponent", scope: "same-lane", damageSource: "self-current-hp", note: "Damage = this character's own HP. If fatal, this action is free." }
  },
  "Wheelie": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "move", side: "ally", scope: "any-lane", note: "Moves a DIFFERENT ally — pick the ally, then its destination." },
    a3: { mode: "single", side: "opponent", scope: "same-lane", note: "coin: Heads only — instant destroy." }
  },
  "Yukiko": {
    a1: { mode: "single", side: "opponent", scope: "same-lane" },
    a2: { mode: "move", side: "self", scope: "adjacent" },
    a3: { mode: "all", side: "opponent", scope: "same-lane", note: "Only hits cards that are currently disabled in some way — check before applying." }
  },
  "Yure": {
    a1: { mode: "move", side: "self", scope: "adjacent" },
    a2: { mode: "single", side: "opponent", scope: "same-lane", note: "Disables the target for one turn." },
    a3: { mode: "move", side: "self", scope: "adjacent", note: "Then move any other card (friend or foe, from anywhere) into this same destination lane — second sub-step." }
  }
};
