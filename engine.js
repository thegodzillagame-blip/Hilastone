// ============================================================================
// Hilastone Resolution Engine — Phase 1 proof of concept
// ============================================================================
//
// Design summary (see conversation for full rationale):
//  - One client computes a full action resolution locally (incl. any RNG),
//    producing a sequence of GameEvents. The opposing client never re-derives
//    results — it only applies the events it receives. This avoids desync
//    without needing a real backend.
//  - Cards are pure data (src/cards.json) built from a small op vocabulary.
//  - This module is environment-agnostic (no DOM/Firestore) so it can be
//    unit tested standalone and later embedded in the existing HTML client
//    or ported to a Cloud Function unchanged.
// ============================================================================

const LANES = ["Left", "Center", "Right"];
const LANE_CAP = 4;
const HAND_SIZE = 10;
const BASE_ENERGY = 5;
const TURN_CLOCK_MS = 10 * 60 * 1000; // 10 minutes per turn — resets at the start of each of your turns

// ---------------------------------------------------------------------------
// RNG — seeded, deterministic, so the resolving client's coin flips/dice
// rolls can be replayed identically by the receiving client from the same
// seed if ever needed (e.g. replay/audit), even though in the trust model
// only the resolving client computes and the result is just shipped as data.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function uid(prefix) {
  prefix = prefix || "id";
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

function freshPlayerState(hand) {
  return {
    hand: hand.slice(),
    energy: BASE_ENERGY,
    boardLeft: [], boardCenter: [], boardRight: [],
    graveyard: [],
    pendingEffects: [],          // delayed effects: { resolveAt: {type, ownerSeat}, effects, frame }
    endedLastTurnAtZeroEnergy: false, // for Shelby/Vivian-style triggers
    // -- app-level fields, orthogonal to combat resolution --
    name: null,                  // display name, set on seat pick
    pool: [],                    // cards picked during setup, before locking
    handLocked: false,
  };
}

function freshGameState(hand1, hand2) {
  return {
    // -- app-level fields --
    createdAt: Date.now(),
    phase: "setup",              // setup -> playing
    clockMs: { "1": TURN_CLOCK_MS, "2": TURN_CLOCK_MS },
    clockRunning: false,
    lastTickAt: null,
    // -- engine-native combat fields --
    players: { "1": freshPlayerState(hand1 || []), "2": freshPlayerState(hand2 || []) },
    currentTurn: "1",
    turnNumber: 1,
    log: [],
  };
}

function laneKey(lane) { return "board" + lane; }

function findUnit(state, instanceId) {
  for (const seat of ["1", "2"]) {
    for (const lane of LANES) {
      const units = state.players[seat][laneKey(lane)];
      const idx = units.findIndex(function (u) { return u.instanceId === instanceId; });
      if (idx >= 0) return { unit: units[idx], seat: seat, lane: lane, idx: idx };
    }
  }
  return null;
}

function instanceFromCard(cardDef, seat) {
  const inst = {
    instanceId: uid("u"),
    name: cardDef._name,
    ownerSeat: seat,
    hp: cardDef.hp,
    maxHp: cardDef.hp,
    statuses: [],
    flags: {},
    counters: {},      // once-per-turn gates, e.g. { freeSummonUsed: true }, reset each owner turn start
    damageTakenThisTurn: 0, // for "once per turn" / capped-damage cards (Ridley, Cinwicke, Margerine)
  };
  if (cardDef.passive && cardDef.passive.trigger === "passive_continuous" && cardDef.passive.mode) {
    inst.flags.mode = cardDef.passive.mode.startsIn;
  }
  return inst;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
function addStatus(unit, status) {
  status.id = status.id || uid("st");
  unit.statuses.push(status);
}

function removeStatusesById(unit, ids) {
  unit.statuses = unit.statuses.filter(function (s) { return ids.indexOf(s.id) === -1; });
}

// Called at the start of a seat's turn: status with expires "until_next_turn"
// that was applied during *this same seat's* previous turn now expires.
// ("removed by your next turn" means it survives the opponent's turn and
// dies at the start of the original caster's next turn.) Also resets this
// seat's units' once-per-turn counters and per-turn damage-taken trackers —
// these are personal to the unit's own turn cadence (matches "once per turn"
// reading on cards like Ridley/Cinwicke/Cordelia/Kazura/Reishi).
function expireStatusesOnTurnStart(state, seat) {
  for (const lane of LANES) {
    for (const u of state.players[seat][laneKey(lane)]) {
      // Roll back temporary HP before stripping the status — temp_heal_rollback
      // tracks exactly how much bonus HP was granted so we can remove it precisely.
      for (const s of u.statuses) {
        if (s.kind === "temp_heal_rollback" &&
            s.expires && s.expires.type === "until_next_turn" &&
            s.expires.ownerSeatAtApply === seat) {
          u.hp = Math.max(1, u.hp - s.amount);
        }
      }
      u.statuses = u.statuses.filter(function (s) {
        if (s.expires && s.expires.type === "until_next_turn" && s.expires.ownerSeatAtApply === seat) return false;
        if (s.expires && s.expires.type === "this_turn" && s.expires.ownerSeatAtApply === seat) return false;
        return true;
      });
      u.counters = {};
      u.damageTakenThisTurn = 0;
    }
  }
}

// Clears statuses that should last through the turn but expire at its end —
// specifically disable_actions applied via "until_their_next_turn", which
// should block the target for their whole next turn, not be cleared before
// they even act. Called at the end of `seat`'s turn (in endTurn, before
// starting the next player's turn).
function expireStatusesOnTurnEnd(state, seat) {
  // Expire "until_turn_end" statuses for the seat whose turn is ending.
  // IMPORTANT: borrowed_passive_op/trigger use ownerSeatAtApply=oppSeat,
  // meaning they expire at the end of the OPPONENT's turn — so we must
  // scan ALL units on the board, not just the expiring seat's units.
  for (const scanSeat of ["1", "2"]) {
    for (const lane of LANES) {
      for (const u of state.players[scanSeat][laneKey(lane)]) {
        const hadBorrowed = u.statuses.some(function(s) {
          return (s.kind === "borrowed_passive_op" || s.kind === "borrowed_passive_trigger") &&
                 s.expires && s.expires.type === "until_turn_end" && s.expires.ownerSeatAtApply === seat;
        });
        u.statuses = u.statuses.filter(function (s) {
          if (s.expires && s.expires.type === "until_turn_end" && s.expires.ownerSeatAtApply === seat) return false;
          return true;
        });
        // Clear the copied passive icon once all borrowed statuses have expired
        if (hadBorrowed && !u.statuses.some(function(s) { return s.kind === "borrowed_passive_op" || s.kind === "borrowed_passive_trigger"; })) {
          if (u.flags) u.flags.copiedPassiveName = null;
        }
      }
    }
  }
}

function hasStatus(unit, kind) {
  return unit.statuses.some(function (s) { return s.kind === kind; });
}
function getStatus(unit, kind) {
  return unit.statuses.find(function (s) { return s.kind === kind; });
}

// ---------------------------------------------------------------------------
// The Engine
// ---------------------------------------------------------------------------
class Engine {
  /**
   * @param {object} cardDefs - map name -> card def (see cards.json)
   * @param {object} state - GameState
   * @param {number} rngSeed
   */
  constructor(cardDefs, state, rngSeed) {
    this.cards = {};
    for (const name of Object.keys(cardDefs)) {
      this.cards[name] = Object.assign({}, cardDefs[name], { _name: name });
    }
    this.state = state;
    this.rng = makeRng(rngSeed === undefined ? Date.now() : rngSeed);
    this.events = []; // events produced by the *current* resolution call
  }

  cardDef(name) { return this.cards[name]; }

  emit(type, payload) {
    const ev = Object.assign({ type: type }, payload, { ts: Date.now() });
    this.events.push(ev);
    this.state.log.push(ev);
    // Keep the log from growing unboundedly — the UI only needs recent
    // events for toast deduplication (coin flips, auto-summons, etc.).
    // Trim lazily every 50 emits to avoid an O(n) splice on every single event.
    if (this.state.log.length > 220) {
      this.state.log.splice(0, this.state.log.length - 200);
    }
    return ev;
  }

  opponentOf(seat) { return seat === "1" ? "2" : "1"; }

  // -- summon / turn flow --------------------------------------------------

  summon(seat, cardName, lane, opts) {
    opts = opts || {};
    const free = !!opts.free;
    const p = this.state.players[seat];
    const idx = p.hand.indexOf(cardName);
    if (idx < 0) throw new Error(cardName + " not in hand");
    const def = this.cardDef(cardName);
    const lk = laneKey(lane);
    if (p[lk].length >= LANE_CAP) throw new Error("Lane full");

    // Carmella: "No characters can be summoned to the same lane as this
    // character. This Ability affects all players." Checked against BOTH
    // seats' boards since it's lane-wide, not seat-scoped.
    if (this.isLaneSummonBlockedByCarmella(lane)) throw new Error("Lane is summon-blocked");
    // A.L.I.C.E.: "When this character is placed, the opponent cannot summon
    // any characters in the lane on their next turn." Temporary, opponent-only,
    // tracked via a per-lane ban map on the affected seat's player state.
    if (this.isLaneSummonBannedFor(seat, lane)) throw new Error("Lane summon temporarily banned");

    let cost = this.effectiveCost(seat, cardName);
    let usedAnyDefeatFree = false;
    if (p._freeSummonCards && p._freeSummonCards[cardName]) {
      cost = 0;
      usedAnyDefeatFree = true;
    }
    // Cordelia: "While this character is active, one character can be
    // summoned for free per turn." Player must explicitly opt in via
    // opts.useCordeliaFree (it's a choice, not automatic — Cordelia doesn't
    // know in advance which summon the player wants to spend it on).
    let usedCordeliaFree = false;
    if (opts.useCordeliaFree && !usedAnyDefeatFree) {
      const cordelia = this.findActiveUnitGrantingFreeSummon(seat);
      if (cordelia && !cordelia.counters.freeSummonUsed) {
        cost = 0;
        usedCordeliaFree = true;
      }
    }
    if (!free && p.energy < cost) throw new Error("Not enough energy");

    p.hand.splice(idx, 1);
    const unit = instanceFromCard(def, seat);
    p[lk].push(unit);
    if (!free) p.energy -= cost;
    if (usedAnyDefeatFree) p._freeSummonCards[cardName] = false;
    if (usedCordeliaFree) {
      const cordelia = this.findActiveUnitGrantingFreeSummon(seat);
      if (cordelia) cordelia.counters.freeSummonUsed = true;
    }

    this.emit("summon", { seat: seat, lane: lane, cardName: cardName, instanceId: unit.instanceId, free: free || usedAnyDefeatFree || usedCordeliaFree });

    // Blitzmarsch (and any future card with modify_max_hp + own_hand_size):
    // apply the hand-size HP bonus as actual hp at summon time so it counts
    // as real HP (and over-health when above base max). The continuous passive
    // still makes getEffectiveMaxHp() return the right ceiling for display; the
    // heal here makes unit.hp actually start at that ceiling.
    if (def.passive && def.passive.trigger === "passive_continuous") {
      const hasHandSizeHp = def.passive.effects.some(function(e) { return e.op === "modify_max_hp" && e.amount_from === "own_hand_size"; });
      if (hasHandSizeHp) {
        // p.hand was already spliced above (card removed before summon), so
        // hand.length is cards remaining AFTER Blitzmarsch left the hand.
        const bonus = p.hand.length;
        if (bonus > 0) {
          unit.hp += bonus;
          this.emit("heal", { instanceId: unit.instanceId, amount: bonus, before: unit.hp - bonus, after: unit.hp, temporary: false });
        }
      }
    }

    this.firePassiveTrigger("on_place", { seat: seat, lane: lane, instanceId: unit.instanceId, passiveTargets: opts.passiveTargets || {} });
    this.applyOnPlaceLaneBans(unit, seat, lane);
    this.checkLinkedSummons(seat);
    this.maybeFireTurnStartPassiveOnSummon(unit, seat, lane, def);
    return unit;
  }

  // "Every turn this character is active" passives (Ilynn, Wheelie, Chamorie,
  // Syrah Rosé, and the same on_turn_start family on Lilith/Reishi/Selene)
  // normally only fire from startTurn()'s firePassiveTrigger sweep, which
  // means a unit summoned MID-turn would otherwise sit out entirely until
  // its owner's *next* turn start — effectively skipping the turn it was
  // summoned on. Since these are meant to apply on every turn the unit is
  // active, and the unit IS active for the remainder of the current turn if
  // it's being summoned during its own owner's turn, fire the passive once
  // immediately here too. Only applies when summoned during the OWNER's own
  // turn (summoning during the opponent's turn — e.g. via some future
  // opponent's-turn summon effect — would have no "this turn" to apply to
  // from this unit's perspective, so it just waits for the normal sweep).
  maybeFireTurnStartPassiveOnSummon(unit, seat, lane, def) {
    if (this.state.currentTurn !== seat) return;
    if (!def.passive) return;
    const trigger = def.passive.trigger;
    if (trigger !== "on_turn_start" && trigger !== "on_turn_start_self_cost") return;
    if (hasStatus(unit, "passive_negated")) return;
    const ctx = { seat: seat };
    if (def.passive.scope === "both_players" && trigger === "on_turn_start") {
      this.resolveWheelieLikePassive(unit, seat, lane, def, ctx);
    } else {
      this.runPassiveEffects(unit, seat, lane, def, ctx);
    }
  }

  findActiveUnitGrantingFreeSummon(seat) {
    for (const lane of LANES) {
      for (const u of this.state.players[seat][laneKey(lane)]) {
        if (hasStatus(u, "passive_negated")) continue;
        const def = this.cardDef(u.name);
        if (def.passive && def.passive.trigger === "passive_continuous" &&
          def.passive.effects.some(function (e) { return e.op === "free_summon_per_turn"; })) {
          return u;
        }
      }
    }
    return null;
  }

  isLaneSummonBlockedByCarmella(lane) {
    for (const seat of ["1", "2"]) {
      for (const u of this.state.players[seat][laneKey(lane)]) {
        if (hasStatus(u, "passive_negated")) continue;
        const def = this.cardDef(u.name);
        if (def.passive && def.passive.trigger === "passive_continuous" &&
          def.passive.effects.some(function (e) { return e.op === "block_summons_in_lane"; })) {
          return true;
        }
      }
    }
    return false;
  }

  isLaneSummonBannedFor(seat, lane) {
    const bans = this.state.players[seat]._summonBans;
    return !!(bans && bans[lane] && bans[lane].turnsRemaining > 0);
  }

  applyOnPlaceLaneBans(unit, seat, lane) {
    const def = this.cardDef(unit.name);
    if (!def.passive || def.passive.trigger !== "on_place") return;
    for (const eff of def.passive.effects) {
      if (eff.op === "ban_opponent_summon_in_lane") {
        const oppSeat = this.opponentOf(seat);
        const opp = this.state.players[oppSeat];
        opp._summonBans = opp._summonBans || {};
        opp._summonBans[lane] = { turnsRemaining: 1 };
        this.emit("summon_ban_applied", { seat: oppSeat, lane: lane });
      }
    }
  }

  // Piper's "free_summon_if" passive op: if Piper is active for a seat and
  // Linnaeus is in that seat's hand, auto-summon Linnaeus for free into
  // Piper's lane.
  checkLinkedSummons(seat) {
    const p = this.state.players[seat];
    for (const lane of LANES) {
      for (const u of p[laneKey(lane)].slice()) {
        const def = this.cardDef(u.name);
        if (!def.passive || def.passive.trigger !== "passive_continuous") continue;
        for (const eff of def.passive.effects) {
          if (eff.op === "free_summon_if" && p.hand.indexOf(eff.card) >= 0) {
            const alreadyOnBoard = LANES.some(function (l) {
              return p[laneKey(l)].some(function (x) { return x.name === eff.card; });
            });
            if (!alreadyOnBoard) {
              this.summon(seat, eff.card, lane, { free: true });
            }
          }
        }
      }
    }
  }

  startTurn(seat) {
    this.state.currentTurn = seat;
    this.state.players[seat].energy = BASE_ENERGY;
    const carryover = this.state.players[seat]._carryoverEnergy || 0;
    if (carryover > 0) {
      this.state.players[seat].energy += carryover;
      this.state.players[seat]._carryoverEnergy = 0;
    }
    this.emit("energy_change", { seat: seat, amount: BASE_ENERGY + carryover, newTotal: this.state.players[seat].energy, reason: "turn_reset" });
    expireStatusesOnTurnStart(this.state, seat);

    // Linnaeus: if he's in hand but Piper is gone (not in hand, not on board),
    // he's auto-defeated — card text: "Considered defeated if Piper is unusable."
    for (const turnSeat of ["1", "2"]) {
      const tp = this.state.players[turnSeat];
      if (tp.hand.includes("Linnaeus")) {
        const piperOnBoard = LANES.some(l => tp[laneKey(l)].some(u => u.name === "Piper"));
        const piperInHand = tp.hand.includes("Piper");
        if (!piperOnBoard && !piperInHand) {
          const linnIdx = tp.hand.indexOf("Linnaeus");
          tp.hand.splice(linnIdx, 1);
          tp.graveyard.push("Linnaeus");
          this.emit("defeat", { instanceId: null, name: "Linnaeus", seat: turnSeat, lane: null, reason: "linked_lifecycle" });
        }
      }
    }

    this.emit("turn_start", { seat: seat });
    this.firePassiveTrigger("on_turn_start", { seat: seat });
    this.flushPendingEffects(seat, "turn_start");
    this.firePassiveTrigger("on_turn_start_self_cost", { seat: seat });
  }

  decaySummonBans(seat) {
    const bans = this.state.players[seat]._summonBans;
    if (!bans) return;
    for (const lane of Object.keys(bans)) {
      if (bans[lane].turnsRemaining > 0) bans[lane].turnsRemaining -= 1;
    }
  }

  endTurn(seat) {
    const p = this.state.players[seat];
    p.endedLastTurnAtZeroEnergy = p.energy <= 0;
    this.emit("turn_end", { seat: seat, endedAtZeroEnergy: p.endedLastTurnAtZeroEnergy });
    if (p.endedLastTurnAtZeroEnergy) {
      this.firePassiveTrigger("on_turn_end_zero_energy", { seat: seat });
    }
    // alsoOnTurnEnd: secondary effects on on_attacked passives (Nurse Anna: heal
    // if not attacked this turn). Fires for the seat whose turn is ending.
    for (const lane of LANES) {
      for (const unit of this.state.players[seat][laneKey(lane)].slice()) {
        if (hasStatus(unit, "passive_negated")) continue;
        const def = this.cardDef(unit.name);
        if (!def.passive || !def.passive.alsoOnTurnEnd) continue;
        for (const eff of def.passive.alsoOnTurnEnd) {
          if (eff.condition === "not_attacked_this_turn" && unit.damageTakenThisTurn > 0) continue;
          this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: {} });
        }
      }
    }
    // Borrowed passive triggers for on_turn_end_zero_energy
    if (p.endedLastTurnAtZeroEnergy) {
      for (const lane of LANES) {
        for (const unit of this.state.players[seat][laneKey(lane)].slice()) {
          this.fireBorrowedTrigger(unit, seat, lane, "on_turn_end_zero_energy", { seat: seat });
        }
      }
    }
    this.flushPendingEffects(seat, "turn_end");
    // Clear stuns/disables that lasted through this seat's full turn
    // (applied via "until_their_next_turn" — should expire at end of their
    // turn, not at start, so the target was actually blocked while acting).
    expireStatusesOnTurnEnd(this.state, seat);
    // A.L.I.C.E.'s summon ban covers exactly "their next turn" — decremented
    // at the END of the banned seat's turn so the ban is active throughout it
    // and clears in time for the turn after.
    this.decaySummonBans(seat);
    const next = this.opponentOf(seat);
    this.startTurn(next);
  }

  // -- delayed ("by your next turn" / "at the end of the opponent's next
  //    turn") effects ------------------------------------------------------

  /**
   * Schedules effects to run later. `resolveAt` describes when:
   *   { type: "turn_start", ownerSeat }  -> fires at the start of ownerSeat's
   *                                          next turn (the common "by your
   *                                          next turn" phrasing)
   *   { type: "turn_end", ownerSeat }    -> fires at the end of ownerSeat's
   *                                          NEXT turn (Carmella/Venia's
   *                                          "at the end of the opponent's
   *                                          next turn" phrasing — ownerSeat
   *                                          here is whoever's turn must end)
   */
  schedulePendingEffect(casterSeat, resolveAt, effects, frame) {
    this.state.players[casterSeat].pendingEffects.push({
      resolveAt: resolveAt, effects: effects,
      frame: { actorSeat: frame.actorSeat, actorLane: frame.actorLane, targets: frame.targets, actorUnitId: frame.actorUnit ? frame.actorUnit.instanceId : null },
    });
  }

  flushPendingEffects(seat, momentType) {
    for (const casterSeat of ["1", "2"]) {
      const p = this.state.players[casterSeat];
      const remaining = [];
      for (const pending of p.pendingEffects) {
        const matches = pending.resolveAt.type === momentType && pending.resolveAt.ownerSeat === seat;
        if (!matches) { remaining.push(pending); continue; }
        const foundActor = pending.frame.actorUnitId ? findUnit(this.state, pending.frame.actorUnitId) : null;
        const runFrame = {
          actorUnit: foundActor ? foundActor.unit : null,
          actorSeat: pending.frame.actorSeat,
          // Use the actor's CURRENT lane if it's still on the board — the
          // snapshot in pending.frame.actorLane goes stale if the unit moved
          // after the effect was scheduled (e.g. Syrah a3: move then deal
          // delayed damage to cards in "that" lane). If the actor is gone
          // (defeated before the effect fires), keep the original lane so
          // effects like Gunpowder's delayed blast still know where to land.
          actorLane: foundActor ? foundActor.lane : pending.frame.actorLane,
          targets: pending.frame.targets,
        };
        for (const eff of pending.effects) this.runOp(eff, runFrame);
      }
      p.pendingEffects = remaining;
    }
  }

  // -- passive trigger dispatch --------------------------------------------

  firePassiveTrigger(trigger, ctx) {
    for (const seat of ["1", "2"]) {
      // on_turn_start (non-Wheelie), on_turn_start_self_cost, and
      // on_turn_end_zero_energy are inherently "this seat's own units react
      // to their own turn boundary" triggers — skip the other seat entirely
      // so e.g. Shelby on seat 2 doesn't see seat 1 ending their turn at 0
      // energy, and so Ilynn ("every turn" = every turn SHE is active, i.e.
      // her owner's own turn) doesn't also fire on the opponent's turn.
      if ((trigger === "on_turn_end_zero_energy" || trigger === "on_turn_start_self_cost") && seat !== ctx.seat) continue;
      for (const lane of LANES) {
        for (const unit of this.state.players[seat][laneKey(lane)].slice()) {
          const def = this.cardDef(unit.name);
          if (!def.passive || def.passive.trigger !== trigger) continue;
          if (hasStatus(unit, "passive_negated")) continue;
          if (def.passive.scope === "both_players" && trigger === "on_turn_start") {
            this.resolveWheelieLikePassive(unit, seat, lane, def, ctx);
            continue;
          }
          // on_turn_start passives only fire on their OWNER's turn start —
          // Audrey, Selene, Ilynn etc. should not tick on the opponent's turn.
          if (trigger === "on_turn_start" && seat !== ctx.seat) continue;
          this.runPassiveEffects(unit, seat, lane, def, ctx);
        }
      }
      // Borrowed passive triggers (Crumbs copying on_turn_start passives like Reishi)
      for (const lane of LANES) {
        for (const unit of this.state.players[seat][laneKey(lane)].slice()) {
          this.fireBorrowedTrigger(unit, seat, lane, trigger, ctx);
        }
      }
    }
  }

  runPassiveEffects(unit, seat, lane, def, ctx) {
    // ctx.passiveTargets carries player-chosen targets for on_place passives
    // (e.g. Venia's forced defeats). Merged into the targets object so
    // resolveTargetUnits can find enemyChoiceAnyLane / allyChoiceAnyLane.
    const targets = (ctx && ctx.passiveTargets) ? ctx.passiveTargets : {};
    for (const eff of def.passive.effects) {
      this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, ctx: ctx, targets: targets, isPassive: true });
    }
  }

  resolveWheelieLikePassive(unit, seat, lane, def, ctx) {
    const isOwnTurn = ctx.seat === seat;
    for (const eff of def.passive.effects) {
      if (eff.when === "self_turn_start" && isOwnTurn) {
        this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, ctx: ctx, isPassive: true });
      } else if (eff.when === "opp_turn_start" && !isOwnTurn) {
        this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, ctx: ctx, isPassive: true });
      }
    }
  }

  // -- the main entry point: resolve a card action -------------------------

  resolveAction(seat, instanceId, actionIndex, targets) {
    targets = targets || {};
    const found = findUnit(this.state, instanceId);
    if (!found || found.seat !== seat) throw new Error("Unit not found or not yours");
    const unit = found.unit, lane = found.lane;
    const def = this.cardDef(unit.name);
    const action = this.lookupAction(def, unit, actionIndex);
    if (!action) throw new Error("No such action");

    if (action.condition && !this.checkCondition(action.condition, { actorUnit: unit, actorSeat: seat, actorLane: lane })) {
      throw new Error("Action condition not met");
    }
    // Crumbs (and any future card with oncePerTurn passive action): block re-use within same turn
    if (actionIndex === "passive" && def.passive && def.passive.oncePerTurn) {
      if (unit.counters._passiveUsed) throw new Error("Passive already used this turn");
      unit.counters._passiveUsed = true;
    }
    if (hasStatus(unit, "disable_actions")) throw new Error("Unit is disabled");
    if (this.getContinuousState(unit).disabledByLaneController) throw new Error("Only the lane controller can act here");

    const p = this.state.players[seat];
    let cost = action.cost;
    if (action.costWaiver && this.checkCostWaiver(action.costWaiver, { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: targets })) {
      cost = 0;
    }
    // Generic one-shot "next action is free" flag — set by Reishi's coin
    // flip, Shelby's/Vivian's zero-energy-end-of-turn passives, etc. Consumed
    // on use regardless of which action is taken.
    if (unit.flags.nextActionFree) {
      cost = 0;
      unit.flags.nextActionFree = false;
      this.emit("free_action_consumed", { instanceId: instanceId });
    }
    if (p.energy < cost) throw new Error("Not enough energy");
    p.energy -= cost;

    this.emit("action", { seat: seat, instanceId: instanceId, cardName: unit.name, actionIndex: actionIndex, cost: cost });

    // One shared frame object for every effect in this action's effect list
    // (rather than a fresh literal per effect) — this is what lets a "move,
    // then act on the new lane" sequence (Syrah a3: move to a lane, then
    // damage everyone in THAT lane, self included) see the post-move lane.
    // op_move updates frame.actorLane in place when eff.target === "self"
    // resolves to the acting unit, so any later effect in the same list
    // reads the unit's current lane instead of a stale snapshot.
    const sharedFrame = { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: targets, isPassive: false, spentCost: cost };
    for (const eff of action.effects) {
      this.runOp(eff, sharedFrame);
    }

    return this.events;
  }

  // Resolves which action definition to use for a given actionIndex, taking
  // Tanker-style mode-keyed movesets into account. For ordinary cards,
  // def.actions[actionIndex] is returned unchanged. For mode cards,
  // def.actions[actionIndex] is itself a map of mode -> action.
  lookupAction(def, unit, actionIndex) {
    // "passive" is a sentinel actionIndex (distinct from the numeric 0/1/2
    // combat-action slots) for a card's manually-activated passive trigger
    // — e.g. Tanker's "spend 1 Energy to switch Robot/Tank mode." These live
    // in def.passiveAction (set from passiveActionData) rather than
    // def.actions, since they're not one of the card's 3 numbered combat
    // actions and shouldn't be copy-able via copy_ability or counted by
    // anything that assumes exactly 3 actions.
    if (actionIndex === "passive") {
      return def.passiveAction || null;
    }
    const raw = def.actions[actionIndex];
    if (!raw) return null;
    if (def.passive && def.passive.mode && raw.byMode) {
      return raw.byMode[unit.flags.mode] || null;
    }
    return raw;
  }

  checkCostWaiver(waiver, ctx) {
    const destLane = ctx.targets.destination;
    if (!destLane) return false;
    const oppSeat = this.opponentOf(ctx.actorSeat);
    if (waiver.condition === "destination_enemy_count_lte") {
      const count = this.state.players[oppSeat][laneKey(destLane)].length;
      return count <= waiver.value;
    }
    if (waiver.condition === "destination_any_count_gte") {
      const count = this.state.players["1"][laneKey(destLane)].length + this.state.players["2"][laneKey(destLane)].length;
      return count >= waiver.value;
    }
    if (waiver.condition === "destination_any_count_eq") {
      const count = this.state.players["1"][laneKey(destLane)].length + this.state.players["2"][laneKey(destLane)].length;
      return count === waiver.value;
    }
    if (waiver.condition === "destination_has_card") {
      return this.state.players["1"][laneKey(destLane)].some(function (u) { return u.name === waiver.value; })
        || this.state.players["2"][laneKey(destLane)].some(function (u) { return u.name === waiver.value; });
    }
    return false;
  }

  checkCondition(cond, ctx) {
    switch (cond.type) {
      case "card_active": {
        for (const seat of ["1", "2"]) {
          for (const lane of LANES) {
            if (this.state.players[seat][laneKey(lane)].some(function (u) { return u.name === cond.name; })) return true;
          }
        }
        return false;
      }
      case "card_in_same_lane": {
        return this.state.players[ctx.actorSeat][laneKey(ctx.actorLane)].some(function (u) { return u.name === cond.name; });
      }
      case "ally_count_in_lane": {
        const n = this.state.players[ctx.actorSeat][laneKey(ctx.actorLane)].length;
        return this.compareOp(n, cond.op, cond.value);
      }
      case "enemy_count_in_lane": {
        const oppSeat = this.opponentOf(ctx.actorSeat);
        const n = this.state.players[oppSeat][laneKey(ctx.actorLane)].length;
        return this.compareOp(n, cond.op, cond.value);
      }
      default:
        return true;
    }
  }

  compareOp(a, op, b) {
    switch (op) {
      case "gte": return a >= b;
      case "lte": return a <= b;
      case "eq": return a === b;
      case "gt": return a > b;
      case "lt": return a < b;
      default: return false;
    }
  }

  // -- continuous passive system --------------------------------------------
  //
  // Every "passive_continuous" effect is a standing modifier rather than a
  // one-shot event. Instead of writing a bespoke scanner at each call site
  // (the Phase 1 approach — isLockedByDomi, getEffectiveMaxHp's inline loop,
  // the inline immunity check in applyDamage, etc.), every continuous effect
  // is folded into ONE function: getContinuousState(unit). It walks the
  // entire board fresh each call (cheap at this scale — at most a few dozen
  // units) and returns a normalized bag of modifiers currently affecting
  // that unit. Nothing is cached or pre-applied as a status, so it can never
  // go stale: if Piper leaves the lane, Linnaeus's buff disappears the very
  // next time anyone asks, with no manual cleanup step required.
  //
  // To add a new continuous passive op in Phase 2: add one case to
  // applyContinuousEffect() below. Every read site (damage, movement, max HP,
  // summon legality, ...) automatically sees it — no new call sites needed.

  /**
   * @param {UnitInstance} unit - the unit to compute modifiers FOR
   * @returns {object} bag of modifiers, see shape below
   */
  getContinuousState(unit) {
    const bag = {
      maxHpBonus: 0,
      damageDealtBonus: 0,
      damageDealtMultiplier: 1,
      damageTakenMultiplier: 1,
      damageTakenCapPerHit: null,   // e.g. Margerine: 2, Ridley/Cinwicke: handled via once-per-turn instead
      immuneUnless: null,           // e.g. "multi_target" (Calamity) or "single_target" (Audrey)
      fullyImmune: false,           // Peggy: blanket immunity gated on board state (ally count), not attack shape
      movementLocked: false,
      cannotBeMoved: false,         // Rannivieve: "Bolted Down" — immune to ALL move sources, even self
      cannotBeStoppedFromMoving: false, // Halcyon: immune to disable/lock on movement specifically
      summonBlockedInLane: false,   // Carmella
      boostMultiplier: 1,           // Andromeda: doubles damage/HP-boost ops cast by allies in her lane
      disabledByLaneController: false, // Ellie Ember: only she can act in her lane
    };
    const found = findUnit(this.state, unit.instanceId);
    if (!found) return bag;
    if (hasStatus(unit, "passive_negated")) return bag;

    // Self-sourced continuous effects (the unit's own passive, e.g. Headstart,
    // Stealth 100, Linnaeus's Parasitism buff).
    const selfDef = this.cardDef(unit.name);
    if (selfDef.passive && selfDef.passive.trigger === "passive_continuous") {
      for (const eff of selfDef.passive.effects) {
        if (eff.condition && !this.checkCondition(eff.condition, { actorSeat: found.seat, actorLane: found.lane })) continue;
        this.applyContinuousEffect(bag, eff, { sourceUnit: unit, targetUnit: unit, isSelf: true });
      }
    }

    // Borrowed passive ops (Cinwicke/Delici: "apply this card's Passive
    // Ability to an ally, removed by your next turn") — a temporary status
    // carrying just the op name(s) to fold in as if self-sourced.
    const borrowed = unit.statuses.filter(function (s) { return s.kind === "borrowed_passive_op"; });
    for (const b of borrowed) {
      this.applyContinuousEffect(bag, b.meta, { sourceUnit: unit, targetUnit: unit, isSelf: true });
    }

    // Board-sourced continuous effects from OTHER units that target this one
    // (e.g. Domi's lock_movement applies to enemies in her lane; Andromeda's
    // boost applies to allies in her lane).
    for (const seat of ["1", "2"]) {
      for (const lane of LANES) {
        for (const sourceUnit of this.state.players[seat][laneKey(lane)]) {
          if (sourceUnit.instanceId === unit.instanceId) continue;
          if (hasStatus(sourceUnit, "passive_negated")) continue;
          const def = this.cardDef(sourceUnit.name);
          if (!def.passive || def.passive.trigger !== "passive_continuous") continue;
          for (const eff of def.passive.effects) {
            if (!this.continuousEffectApplies(eff, sourceUnit, seat, lane, unit, found)) continue;
            this.applyContinuousEffect(bag, eff, { sourceUnit: sourceUnit, targetUnit: unit, isSelf: false });
          }
        }
      }
    }

    return bag;
  }

  // Decides whether a board-sourced continuous effect (from sourceUnit) is
  // in scope for targetUnit, based on the op's implicit targeting rule.
  continuousEffectApplies(eff, sourceUnit, sourceSeat, sourceLane, targetUnit, targetFound) {
    switch (eff.op) {
      case "lock_movement":
        // "Opposing characters within this character's lane"
        return targetFound.seat !== sourceSeat && targetFound.lane === sourceLane;
      case "boost_allies_in_lane":
        // Andromeda: "Double any Damage or HP boosts within the lane" — applies
        // to allies (including herself is handled by the self-pass separately;
        // here we only need OTHER units in her lane, same seat).
        return targetFound.seat === sourceSeat && targetFound.lane === sourceLane;
      case "block_summons_in_lane":
        // Carmella: affects all players, any unit query about her lane.
        return targetFound.lane === sourceLane;
      case "disable_lane_except_self":
        // Ellie Ember: "No characters except for this one can perform
        // actions in the lane this character is active in" — affects BOTH
        // allies and enemies sharing her lane.
        return targetFound.lane === sourceLane && targetUnit.instanceId !== sourceUnit.instanceId;
      default:
        return false; // self-only ops (modify_max_hp, damage_immunity_unless,
                       // buff_damage w/ condition, damage_dealt_per_*_in_lane)
                       // are handled in the self-pass above
    }
  }

  applyContinuousEffect(bag, eff, ctx) {
    switch (eff.op) {
      case "modify_max_hp":
        if (eff.amount_from === "own_hand_size") {
          const owner = this.state.players[ctx.targetUnit.ownerSeat];
          bag.maxHpBonus += owner.hand.length;
        }
        break;
      case "damage_immunity_unless":
        bag.immuneUnless = eff.exception;
        break;
      case "damage_immunity_if_ally_count_in_lane":
        // Peggy: "can't be damaged if there are three other ally cards in
        // the lane" — i.e. 4 total units in her lane on her own side
        // (herself + 3 others). Checked against the live board, so it turns
        // on/off automatically as allies join/leave, like everything else
        // in this continuous system.
        if (ctx.isSelf) {
          const found3 = findUnit(this.state, ctx.targetUnit.instanceId);
          if (found3) {
            const allyCount = this.state.players[found3.seat][laneKey(found3.lane)].length;
            const othersCount = allyCount - 1; // excluding Peggy herself
            if (this.compareOp(othersCount, "gte", eff.value)) bag.fullyImmune = true;
          }
        }
        break;
      case "lock_movement":
        bag.movementLocked = true;
        break;
      case "cannot_be_moved":
        bag.cannotBeMoved = true;
        break;
      case "cannot_be_stopped_from_moving":
        bag.cannotBeStoppedFromMoving = true;
        break;
      case "damage_taken_cap_per_hit":
        bag.damageTakenCapPerHit = bag.damageTakenCapPerHit === null ? eff.amount : Math.min(bag.damageTakenCapPerHit, eff.amount);
        break;
      case "block_summons_in_lane":
        bag.summonBlockedInLane = true;
        break;
      case "boost_allies_in_lane":
        bag.boostMultiplier *= (eff.multiplier || 2);
        break;
      case "disable_lane_except_self":
        // Guard against the self-pass: a unit's own disable-lane passive
        // must never disable itself (continuousEffectApplies already
        // excludes self for the board-sourced path; this guards the
        // self-pass, which calls applyContinuousEffect unconditionally).
        if (!ctx.isSelf) bag.disabledByLaneController = true;
        break;
      case "damage_dealt_per_enemy_in_lane":
        // Chloe: "+2 extra Damage for every opposing card in the lane" — only
        // meaningful as a self-buff, computed from the unit's OWN lane.
        if (ctx.isSelf) {
          const found = findUnit(this.state, ctx.targetUnit.instanceId);
          if (found) {
            const oppSeat = this.opponentOf(found.seat);
            const count = this.state.players[oppSeat][laneKey(found.lane)].length;
            bag.damageDealtBonus += (eff.amountPer || 0) * count;
          }
        }
        break;
      case "damage_dealt_per_card_in_lane":
        // Orina: "+1 bonus Damage for every card in the lane, friend or foe."
        if (ctx.isSelf) {
          const found2 = findUnit(this.state, ctx.targetUnit.instanceId);
          if (found2) {
            const count2 = this.state.players["1"][laneKey(found2.lane)].length + this.state.players["2"][laneKey(found2.lane)].length;
            bag.damageDealtBonus += (eff.amountPer || 0) * count2;
          }
        }
        break;
      case "buff_damage":
        // Only self-sourced continuous buffs with a duration of "permanent"
        // belong here (e.g. Linnaeus's +3 while Piper is in lane). One-shot
        // status-based buffs (Astaroth's stacking next_attack buff) are NOT
        // routed through this system — they remain real Status objects on
        // the unit, since they have explicit lifecycle (consumed on attack,
        // stack count, etc.) that doesn't fit a recomputed-fresh model.
        if (eff.duration === "permanent" && ctx.isSelf) {
          bag.damageDealtBonus += eff.amount || 0;
          if (eff.multiplier) bag.damageDealtMultiplier *= eff.multiplier;
        }
        break;
      // free_summon_if and linked_lifecycle are board-level sweeps, not
      // per-unit stat modifiers — handled by checkLinkedSummons() and
      // cascadeLinkedDefeats() respectively, not here.
      default:
        break;
    }
  }

  getEffectiveMaxHp(unit) {
    return unit.maxHp + this.getContinuousState(unit).maxHpBonus;
  }

  // -- op interpreter --------------------------------------------------------

  runOp(eff, frame) {
    const handler = this["op_" + eff.op];
    if (!handler) {
      console.warn("Unhandled op:", eff.op);
      return;
    }
    return handler.call(this, eff, frame);
  }

  resolveTargetUnits(selector, frame, eff) {
    const actorSeat = frame.actorSeat, actorLane = frame.actorLane, targets = frame.targets;
    const oppSeat = this.opponentOf(actorSeat);
    switch (selector) {
      case "self":
        return [frame.actorUnit];
      case "single_enemy": {
        const id = targets && targets.singleTarget;
        const found = id && findUnit(this.state, id);
        if (!found || found.seat !== oppSeat) return [];
        if (!eff.anyLane && found.lane !== actorLane) return [];
        return [found.unit];
      }
      case "single_ally": {
        const id = targets && targets.singleTarget;
        const found = id && findUnit(this.state, id);
        return found && found.seat === actorSeat ? [found.unit] : [];
      }
      case "single_any": {
        const id = targets && targets.singleTarget;
        const found = id && findUnit(this.state, id);
        return found ? [found.unit] : [];
      }
      case "all_enemies_in_lane": {
        const lane = eff.anyLane ? ((targets && targets.lane) || actorLane) : actorLane;
        return this.state.players[oppSeat][laneKey(lane)].slice();
      }
      case "all_enemies_all_lanes": {
        // Ninaki a3: "Deal 5 Damage to all opposing cards, regardless of lane."
        let out = [];
        for (const l of LANES) out = out.concat(this.state.players[oppSeat][laneKey(l)].slice());
        return out;
      }
      case "disabled_enemies_in_lane": {
        // Yukiko a3: "all cards in the opposing lane who are disabled in any
        // way" — currently means carrying a disable_actions status.
        const lane = eff.anyLane ? ((targets && targets.lane) || actorLane) : actorLane;
        return this.state.players[oppSeat][laneKey(lane)].filter(function (u) { return hasStatus(u, "disable_actions"); });
      }
      case "all_in_lane": {
        const lane = actorLane;
        return this.state.players["1"][laneKey(lane)].concat(this.state.players["2"][laneKey(lane)]);
      }
      case "all_in_lane_excluding_self": {
        const lane = actorLane;
        return this.state.players["1"][laneKey(lane)].concat(this.state.players["2"][laneKey(lane)])
          .filter(function (u) { return u.instanceId !== frame.actorUnit.instanceId; });
      }
      case "all_allies_in_lane": {
        const arr = this.state.players[actorSeat][laneKey(actorLane)].slice();
        if (!eff.includeSelf) return arr.filter(function (u) { return u.instanceId !== frame.actorUnit.instanceId; });
        return arr;
      }
      case "opposing_lane_choice": {
        const lane = (targets && targets.lane) || actorLane;
        return this.state.players[oppSeat][laneKey(lane)].slice();
      }
      case "adjacent_lanes_all": {
        // Delici: splash damage to lanes adjacent to the actor's lane.
        const idx = LANES.indexOf(actorLane);
        const adj = [LANES[idx - 1], LANES[idx + 1]].filter(Boolean);
        let out = [];
        for (const lane of adj) {
          out = out.concat(this.state.players["1"][laneKey(lane)], this.state.players["2"][laneKey(lane)]);
        }
        return out;
      }
      case "single_enemy_choice_any_lane": {
        // Venia's on_place defeat: opponent card, any lane, player-chosen.
        const id = targets && targets.enemyChoiceAnyLane;
        const found = id && findUnit(this.state, id);
        return found && found.seat === oppSeat ? [found.unit] : [];
      }
      case "single_ally_choice_any_lane": {
        const id = targets && targets.allyChoiceAnyLane;
        const found = id && findUnit(this.state, id);
        return found && found.seat === actorSeat ? [found.unit] : [];
      }
      case "single_enemy_choice": {
        // Yukiko's on_move_self disable target — player chooses which enemy
        // to disable when the move resolves.
        const id = targets && targets.singleTarget;
        const found = id && findUnit(this.state, id);
        return found && found.seat === oppSeat ? [found.unit] : [];
      }
      case "all_allies_in_lane_anywhere": {
        // Halcyon a3: "Move all allies to this lane" — every ally currently
        // NOT already in the actor's lane (those would no-op on move anyway).
        let out = [];
        for (const lane of LANES) {
          if (lane === actorLane) continue;
          out = out.concat(this.state.players[actorSeat][laneKey(lane)]);
        }
        return out;
      }
      case "attacker_marker": {
        // Reactive-passive-only target (Maxine): the unit that just attacked,
        // supplied via targets.attackerInstanceId by maybeOnAttacked's frame.
        const id = targets && targets.singleTarget;
        const found = id && findUnit(this.state, id);
        return found ? [found.unit] : [];
      }
      default:
        if (selector.indexOf("card_choice:") === 0) {
          // e.g. "card_choice:Gunpowder_or_Propane" — player picks between
          // the two named instances (Propane's a1: move Gunpowder OR Propane).
          const id = targets && targets.cardChoiceInstanceId;
          const found = id && findUnit(this.state, id);
          return found ? [found.unit] : [];
        }
        return [];
    }
  }

  // ---- damage / heal -------------------------------------------------------

  op_damage(eff, frame) {
    // Nurse Anna a1: after moving, only hits if an enemy is present in new lane.
    // Auto-picks the first enemy — no picker needed for a conditional 1-cost hit.
    if (eff.condition === "enemy_in_new_lane") {
      const oppSeat = this.opponentOf(frame.actorSeat);
      const enemies = this.state.players[oppSeat][laneKey(frame.actorLane)];
      if (enemies.length === 0) return;
      this.applyDamage(enemies[0], eff.amount, frame.actorUnit, frame.actorSeat, { multiTarget: false, isSelfDamage: false });
      return;
    }
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    let amount = eff.amount;
    if (eff.amountFromRoll) amount = (frame.ctx && frame.ctx.rollResult !== undefined) ? frame.ctx.rollResult : amount;
    if (eff.amountFromMissingHp) {
      // Kazura a2: "Deal 1 Damage for every HP this character is missing" —
      // computed from the ACTOR's own missing HP, not the target's.
      const actor = frame.actorUnit;
      amount = this.getEffectiveMaxHp(actor) - actor.hp;
    }
    if (eff.amountFromSelfHp) {
      amount = frame.actorUnit.hp;
    }
    if (eff.amountPerEnemyInLane) {
      const oppSeat = this.opponentOf(frame.actorSeat);
      const count = this.state.players[oppSeat][laneKey(frame.actorLane)].length;
      amount = eff.amount + eff.amountPerEnemyInLane * count;
    }
    if (eff.amountFromAllyHpSum) {
      // Peggy a3: "Adds together the HP values of every ally in the lane" —
      // includes Peggy herself (she's an ally in her own lane).
      const allies = this.state.players[frame.actorSeat][laneKey(frame.actorLane)];
      amount = allies.reduce(function (sum, u) { return sum + u.hp; }, 0);
    }

    let anyFatal = false;
    let mainTargetFatal = false;
    let killCount = 0;
    // Snapshot continuous states for all targets BEFORE the damage loop.
    // This is critical for Peggy's "Band Together" immunity: if her allies
    // die earlier in the same all_in_lane sweep, her live ally count would
    // drop below 3 mid-loop and strip her immunity before her own hit
    // resolves — even though she had full immunity at the start of the attack.
    // By pre-computing all continuous states once, every unit's immunity is
    // evaluated against the board as it was when the attack landed.
    const isMultiTarget = units.length > 1 || eff.target.indexOf("all_") === 0;
    const precomputedStates = new Map();
    if (isMultiTarget) {
      for (const unit of units) {
        precomputedStates.set(unit.instanceId, this.getContinuousState(unit));
      }
    }
    for (const unit of units) {
      // A resolved target that IS the actor (eff.target === "self", or any
      // selector that happens to include the actor, e.g. all_in_lane) must
      // never be routed through the "attack" path — that path triggers
      // on_attacked/reflect passives, which for self-inflicted damage would
      // be wrong (and, if the actor's own on_attacked passive deals damage
      // back to "the attacker" = itself, causes infinite recursion). This is
      // the general fix; eff.selfDamage below remains a separate convenience
      // for "also deal N to self" alongside a primary enemy-targeted hit.
      const isActorSelf = frame.actorUnit && unit.instanceId === frame.actorUnit.instanceId;
      const result = this.applyDamage(unit, amount, frame.actorUnit, frame.actorSeat, {
        multiTarget: isMultiTarget,
        isSelfDamage: isActorSelf,
        precomputedContinuousState: precomputedStates.get(unit.instanceId),
      });
      if (result && result.wasFatal) { anyFatal = true; mainTargetFatal = true; killCount++; }
    }
    let selfFatal = false;
    if (eff.selfDamage) {
      const selfResult = this.applyDamage(frame.actorUnit, eff.selfDamage, frame.actorUnit, frame.actorSeat, { multiTarget: false, isSelfDamage: true });
      if (selfResult && selfResult.wasFatal) selfFatal = true;
    }
    if (eff.splashAdjacent) {
      // Delici: "All damage dealt with this card deals half the damage to
      // adjacent lanes." Applied once per resolved primary target, halved,
      // rounded up, hitting everyone (friend or foe) in adjacent lanes.
      const splashAmount = Math.ceil(amount * (eff.splashFraction || 0.5));
      const splashUnits = this.resolveTargetUnits("adjacent_lanes_all", frame, eff);
      for (const su of splashUnits) {
        this.applyDamage(su, splashAmount, frame.actorUnit, frame.actorSeat, { multiTarget: true });
      }
    }

    if (eff.onFatal && mainTargetFatal) {
      for (const sub of eff.onFatal) this.runOp(sub, frame);
    }
    if (eff.onAnyFatal && anyFatal) {
      for (const sub of eff.onAnyFatal) this.runOp(sub, frame);
    }
    // onEachFatal: fires once per killed unit (Jacie a2: 1 energy per kill)
    if (eff.onEachFatal && killCount > 0) {
      for (let k = 0; k < killCount; k++) {
        for (const sub of eff.onEachFatal) this.runOp(sub, frame);
      }
    }
    if (eff.onSelfFatal && selfFatal) {
      for (const sub of eff.onSelfFatal) this.runOp(sub, frame);
    }
    if (eff.onFatalRefund && mainTargetFatal) {
      // Vivian a3: "If fatal, this action is free." Refund the energy spent
      // on the action that triggered this damage.
      const p = this.state.players[frame.actorSeat];
      p.energy += frame.spentCost || 0;
      this.emit("energy_change", { seat: frame.actorSeat, amount: frame.spentCost || 0, newTotal: p.energy, reason: "fatal_refund" });
    }
  }

  applyDamage(targetUnit, baseAmount, attackerUnit, attackerSeat, opts) {
    opts = opts || {};
    const multiTarget = !!opts.multiTarget;
    const isSelfDamage = !!opts.isSelfDamage;
    // Pre-computed continuous state from op_damage's snapshot (for multi-target
    // attacks like all_in_lane). Lets Peggy's immunity be evaluated against the
    // board state at attack-start rather than mid-loop after allies may have died.
    const precomputedState = opts.precomputedContinuousState || null;

    const found = findUnit(this.state, targetUnit.instanceId);
    if (!found) return;
    let unit = found.unit;
    const defenderSeat = found.seat;

    if (!isSelfDamage) {
      const redirectTo = this.findRedirectTarget(defenderSeat, found.lane, unit, multiTarget);
      if (redirectTo) {
        unit = redirectTo;
      }
    }

    if (!isSelfDamage) {
      // Use the pre-snapshot state if provided (multi-target attacks snapshot
      // before the loop so Peggy's immunity isn't stripped mid-sweep).
      const defenderState = precomputedState || this.getContinuousState(unit);
      // Peggy: blanket immunity regardless of attack shape, gated only on
      // her own lane's current ally count.
      if (defenderState.fullyImmune) {
        this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "peggy_band_together" });
        return;
      }
      if (defenderState.immuneUnless === "multi_target" && !multiTarget) {
        this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "immune_single_target" });
        return;
      }
      // Audrey-style inverse: "cannot be damaged by multi-target attacks"
      if (defenderState.immuneUnless === "single_target" && multiTarget) {
        this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "immune_multi_target" });
        return;
      }
    }

    if (!isSelfDamage && hasStatus(unit, "negate_damage")) {
      this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "negated" });
      return;
    }
    // Aegon a3: one-shot reflect — deal damage back to attacker, consume status
    if (!isSelfDamage && attackerUnit && hasStatus(unit, "reflect_next_hit")) {
      unit.statuses = unit.statuses.filter(function(s) { return s.kind !== "reflect_next_hit"; });
      this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "reflected" });
      this.applyDamage(attackerUnit, baseAmount, null, null, { multiTarget: false, isSelfDamage: false });
      return;
    }

    // Ridley/Cinwicke-style "can only be damaged once per turn" — a counter
    // gate distinct from a cap: the SECOND hit in a turn is fully blocked,
    // not reduced. Modeled as a per-unit once-per-turn flag, separate from
    // the generic op_once_per_turn_gate (which gates an actor's own ability
    // use, not damage taken from outside).
    const selfDef = this.cardDef(unit.name);
    if (!isSelfDamage && selfDef.passive && selfDef.passive.trigger === "passive_continuous" && !hasStatus(unit, "passive_negated")) {
      const onceGate = selfDef.passive.effects.find(function (e) { return e.op === "damage_taken_once_per_turn"; });
      if (onceGate) {
        if (unit.counters.damagedThisTurn) {
          this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "once_per_turn_used" });
          return;
        }
        unit.counters.damagedThisTurn = true;
      }
    }

    // "If this character is attacked" reactive triggers (Maxine, Mirette,
    // Kazura's once-per-turn negate). Fires BEFORE the damage number is
    // finalized so it can negate/redirect; reflect-after-the-fact passives
    // (Astaroth/Baelia) remain in maybeReflect, called after HP is written.
    if (!isSelfDamage && attackerUnit) {
      const reaction = this.maybeOnAttacked(unit, attackerUnit, multiTarget);
      if (reaction === "negated") {
        this.emit("damage_blocked", { instanceId: unit.instanceId, reason: "on_attacked_negate" });
        return;
      }
      // on_attacked may have moved the unit (Maxine/Mirette) — re-resolve
      // its current location/instance reference in case lane changed (the
      // instanceId is stable across the move, so `unit` reference is still
      // valid; only lane bookkeeping changed, which findUnit handles fresh
      // next time it's looked up).
    }

    let amount = baseAmount;
    if (!isSelfDamage && attackerUnit) {
      // One-shot statuses (Astaroth's stacking next_attack buff, etc.)
      const buffs = attackerUnit.statuses.filter(function (s) { return s.kind === "buff_damage"; });
      for (const b of buffs) {
        amount += b.amount || 0;
        if (b.multiplier) amount *= b.multiplier;
      }
      const consumedIds = buffs.filter(function (b) { return b.expires && b.expires.type === "next_attack"; }).map(function (b) { return b.id; });
      if (consumedIds.length) removeStatusesById(attackerUnit, consumedIds);

      // Standing continuous buffs (Linnaeus's +3 while Piper is in lane, etc.)
      const attackerState = this.getContinuousState(attackerUnit);
      amount += attackerState.damageDealtBonus;
      amount *= attackerState.damageDealtMultiplier;
    }

    if (!isSelfDamage && hasStatus(unit, "halve_damage")) {
      amount = Math.ceil(amount / 2);
    }

    if (amount < 0) amount = 0;

    // Margerine-style flat per-hit cap (applied after all multipliers/buffs,
    // right before the hit lands).
    if (!isSelfDamage) {
      const defenderState2 = this.getContinuousState(unit);
      if (defenderState2.damageTakenCapPerHit !== null) {
        amount = Math.min(amount, defenderState2.damageTakenCapPerHit);
      }
    }

    const before = unit.hp;
    const wouldBeOverkill = !isSelfDamage && (before - amount) < 0;
    unit.hp = Math.max(0, unit.hp - amount);
    // Fire on_damaged borrowed triggers (Crumbs copying Astaroth/Baelia reflect)
    if (!isSelfDamage) {
      const dmgFound = findUnit(this.state, unit.instanceId);
      if (dmgFound) this.fireBorrowedTrigger(unit, dmgFound.seat, dmgFound.lane, "on_damaged", { attacker: attackerUnit, amount: amount });
    }
    this.emit("damage", {
      instanceId: unit.instanceId, amount: amount, before: before, after: unit.hp,
      sourceInstanceId: attackerUnit ? attackerUnit.instanceId : null, multiTarget: multiTarget,
    });

    if (!isSelfDamage && attackerUnit && unit.hp >= 0) {
      this.maybeReflect(unit, attackerUnit, amount, multiTarget);
    }

    let wasFatal = false;
    if (unit.hp <= 0) {
      wasFatal = this.defeatUnit(unit.instanceId, attackerUnit, { exactLethalCheck: !isSelfDamage, overkill: wouldBeOverkill });
    } else if (!isSelfDamage && attackerUnit && !multiTarget) {
      // Remington's Maraud: only fires on a single-target attack landing on
      // a SURVIVING defender (moving a removed unit is meaningless).
      this.maybeMarauд(attackerUnit, unit);
    }
    return { amountDealt: amount, wasFatal: wasFatal, defenderInstanceId: unit.instanceId };
  }

  // Remington: "When attacking a character with a single-target attack, move
  // it to a different lane. If there are other opposing cards in that lane,
  // deal 4 Damage to all opposing cards in that lane."
  maybeMarauд(attackerUnit, defenderUnit) {
    const attackerDef = this.cardDef(attackerUnit.name);
    const attackerFound = findUnit(this.state, attackerUnit.instanceId);
    if (!attackerFound) return;
    // Fire borrowed on_single_target_attack_hit triggers (Crumbs copying Remington)
    this.fireBorrowedTrigger(attackerUnit, attackerFound.seat, attackerFound.lane, "on_single_target_attack_hit", { defender: defenderUnit });
    if (!attackerDef.passive || attackerDef.passive.trigger !== "on_single_target_attack_hit") return;
    const defenderFoundBefore = findUnit(this.state, defenderUnit.instanceId);
    if (!attackerFound || !defenderFoundBefore) return;
    const destLane = this.pickFleeLane(defenderFoundBefore.lane);
    this.runOp(
      { op: "move", target: "single_any", destination: destLane },
      { actorUnit: attackerUnit, actorSeat: attackerFound.seat, actorLane: attackerFound.lane, targets: { singleTarget: defenderUnit.instanceId } }
    );
    const defenderFoundAfter = findUnit(this.state, defenderUnit.instanceId);
    if (!defenderFoundAfter) return; // move was blocked (e.g. lane full / cannot_be_moved)
    const oppSeat = defenderFoundAfter.seat;
    const othersInLane = this.state.players[oppSeat][laneKey(defenderFoundAfter.lane)].filter(function (u) { return u.instanceId !== defenderUnit.instanceId; });
    if (othersInLane.length > 0) {
      // thenIfPopulated effects from the passive data (e.g. deal 4 damage to
      // all enemies in destination lane). We run each effect with the actor's
      // lane updated to the defender's new lane so "all_enemies_in_lane" etc.
      // resolve against the destination rather than Remington's own lane.
      const passiveEff = attackerDef.passive.effects[0];
      const followUpEffects = (passiveEff && passiveEff.thenIfPopulated) || [
        { op: "damage", amount: 4, target: "all_enemies_in_lane" }
      ];
      for (const sub of followUpEffects) {
        this.runOp(sub, {
          actorUnit: attackerUnit,
          actorSeat: attackerFound.seat,
          actorLane: defenderFoundAfter.lane,
          targets: {},
        });
      }
    }
  }

  // Called by the UI after the player picks a destination for a deferred
  // passive move (Maxine's "move to a different lane" on-attacked effect).
  // Clears the pending flag and executes the move.
  // Called by the UI after the player picks which card and lane to free-summon
  // following a Postman Mortem-style on_defeat_self summon_free passive.
  resolvePassiveSummon(seat, cardName, lane) {
    const p = this.state.players[seat];
    if (!p.hand.includes(cardName)) return; // card already gone
    try {
      this.summon(seat, cardName, lane, { free: true });
    } catch (e) {
      this.emit("summon_free_failed", { seat: seat, cardName: cardName, lane: lane, reason: e.message });
    }
  }

  resolvePassiveMove(instanceId, destLane) {
    const found = findUnit(this.state, instanceId);
    if (!found) return;
    if (!found.unit.flags.pendingPassiveMove) return;
    found.unit.flags.pendingPassiveMove = false;
    this.runOp(
      { op: "move", target: "self", destination: destLane },
      { actorUnit: found.unit, actorSeat: found.seat, actorLane: found.lane, targets: { destination: destLane } }
    );
  }

  findRedirectTarget(defenderSeat, lane, originalTarget, multiTarget) {
    const allies = this.state.players[defenderSeat][laneKey(lane)];
    for (const ally of allies) {
      const redirectStatus = getStatus(ally, "redirect_damage");
      if (!redirectStatus) continue;
      if (ally.instanceId === originalTarget.instanceId) continue;
      if (redirectStatus.meta && redirectStatus.meta.singleTargetOnly && multiTarget) continue;
      return ally;
    }
    return null;
  }

  maybeReflect(defender, attacker, amountDealt, multiTarget) {
    const def = this.cardDef(defender.name);
    if (!def.passive || def.passive.trigger !== "on_damaged") return;
    if (def.passive.scope === "single_target" && multiTarget) return;
    for (const eff of def.passive.effects) {
      if (eff.op === "reflect_damage") {
        const reflectAmt = Math.ceil(amountDealt * eff.fraction);
        this.applyDamage(attacker, reflectAmt, null, null, { multiTarget: false, isSelfDamage: false });
      }
    }
  }

  // "If this character is attacked, ..." reactive triggers, fired BEFORE the
  // damage number is finalized (so they can negate or otherwise intercept).
  // Covers: Maxine (counter-damage attacker + flee), Mirette (flee + next-
  // attack-double-damage flag), Kazura (Flower Breathing: once-per-turn full
  // negate), Suraimu (coin-flip negate). Returns "negated" to short-circuit
  // applyDamage, or undefined to let damage proceed normally.
  maybeOnAttacked(defender, attacker, multiTarget) {
    const found = findUnit(this.state, defender.instanceId);
    if (!found) return;
    const def = this.cardDef(defender.name);
    if (!def.passive || def.passive.trigger !== "on_attacked") return;
    if (hasStatus(defender, "passive_negated")) return;
    // Hyperion: "Single-target damage to this character grants 2 bonus Damage."
    // flag_next_attack_bonus only applies to single-target hits. Other on_attacked
    // effects (Maxine counter-damage, Mirette flee) do fire on multi-target too
    // per their card text — so we gate only the flag_next_attack_bonus op.

    let negated;
    for (const eff of def.passive.effects) {
      if (eff.op === "once_per_turn_gate") {
        if (defender.counters[eff.key || "default"]) continue;
        defender.counters[eff.key || "default"] = true;
        for (const sub of eff.effects) {
          if (sub.op === "negate_damage_immediate") negated = "negated";
          else this.runOp(sub, { actorUnit: defender, actorSeat: found.seat, actorLane: found.lane, targets: {} });
        }
      } else if (eff.op === "coin_flip") {
        const heads = this.rng() < 0.5;
        this.emit("coin_flip", { heads: heads, actorInstanceId: defender.instanceId });
        const branch = heads ? eff.onHeads : eff.onTails;
        for (const sub of branch) {
          if (sub.op === "negate_damage_immediate") negated = "negated";
          else this.runOp(sub, { actorUnit: defender, actorSeat: found.seat, actorLane: found.lane, targets: {} });
        }
      } else if (eff.op === "damage") {
        // Maxine: "deal 3 Damage to the attacker"
        this.runOp(eff, { actorUnit: defender, actorSeat: found.seat, actorLane: found.lane, targets: { singleTarget: attacker.instanceId } });
      } else if (eff.op === "move") {
        // Maxine / Mirette: "move to a different lane" — this is a player
        // choice. We can't open a UI picker from inside the engine, so we
        // emit a passive_move_pending event and mark the unit with a flag.
        // The UI detects this event after resolveAction returns, then shows
        // a lane-picker for the owning player. Once they pick, the UI calls
        // the engine's op_move directly with the chosen destination.
        // Mirette's auto_flee is genuinely automatic (card says she moves
        // away, not that the player chooses) — only defer when destination
        // is "choice".
        if (eff.destination === "choice") {
          defender.flags.pendingPassiveMove = true;
          this.emit("passive_move_pending", {
            instanceId: defender.instanceId,
            cardName: defender.name,
            seat: found.seat,
            currentLane: found.lane,
          });
        } else {
          this.runOp(eff, { actorUnit: defender, actorSeat: found.seat, actorLane: found.lane, targets: {} });
        }
      } else if (eff.op === "flag_next_attack_bonus") {
        // Only trigger on single-target attacks (Hyperion's "Single-target damage"
        // wording; a multi-target hit like Aegon a3 should not proc this).
        if (!multiTarget) {
          addStatus(defender, {
            kind: "buff_damage", amount: eff.amount || 0, multiplier: eff.multiplier,
            expires: { type: "next_attack" },
          });
        }
      } else {
        // Generic fallthrough: any other on_attacked op (e.g. Nurse Anna's
        // stacking buff_damage) dispatched with the defender as actor.
        this.runOp(eff, { actorUnit: defender, actorSeat: found.seat, actorLane: found.lane, targets: {} });
      }
    }
    // Borrowed passive triggers (Crumbs copying e.g. Hyperion, Maxine, Ninaki)
    this.fireBorrowedTrigger(defender, found.seat, found.lane, "on_attacked", { multiTarget: multiTarget, attacker: attacker });
    return negated;
  }

  // Picks a lane different from `currentLane` for "move to a different lane"
  // effects that don't have an explicit UI-supplied destination (used by
  // reactive passives that move a unit as a side effect, not a player choice).
  // Prototype simplification: picks the first non-current lane with room.
  pickFleeLane(currentLane) {
    for (const lane of LANES) {
      if (lane !== currentLane) return lane;
    }
    return currentLane;
  }

  op_heal(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    const boost = frame.actorUnit ? this.getLaneBoostMultiplier(frame.actorUnit) : 1;
    const amount = Math.round(eff.amount * boost);
    for (const unit of units) {
      const found = findUnit(this.state, unit.instanceId);
      if (!found) continue;
      const before = found.unit.hp;
      if (eff.hardCap !== undefined) {
        // hardCap: card-specific cap (e.g. Audrey "HP cannot exceed 4",
        // Lilith "HP cannot exceed 10", Vivian "HP cannot exceed 12") that's
        // a deliberate ceiling lower than the unit's normal max HP would
        // otherwise allow — these never overheal past their stated number.
        found.unit.hp = Math.min(eff.hardCap, found.unit.hp + amount);
      } else {
        // Any other heal can push HP above effective max HP — "over health"
        // — rather than being silently wasted once a unit is topped off.
        // There's no separate overHp field: a unit's over-health is simply
        // however much hp currently exceeds getEffectiveMaxHp(unit), read
        // directly by the UI. Damage drains the overflow first automatically
        // since applyDamage just subtracts from the plain hp number.
        found.unit.hp = found.unit.hp + amount;
      }
      this.emit("heal", { instanceId: unit.instanceId, amount: amount, before: before, after: found.unit.hp, temporary: !!eff.temporary });
      if (eff.temporary) {
        addStatus(found.unit, {
          kind: "temp_heal_rollback", amount: amount,
          expires: { type: "until_next_turn", ownerSeatAtApply: frame.actorSeat },
        });
      }
    }
  }

  // ---- movement --------------------------------------------------------

  op_move(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      const found = findUnit(this.state, unit.instanceId);
      if (!found) continue;
      const unitState = this.getContinuousState(found.unit);
      // Rannivieve: "Bolted Down" — cannot be moved by any source, including self.
      if (unitState.cannotBeMoved) {
        this.emit("move_blocked", { instanceId: unit.instanceId, reason: "cannot_be_moved" });
        continue;
      }
      // Halcyon: explicitly immune to being locked/prevented from moving
      // (Domi's lock_movement, or any future "cannot move" effect).
      if (unitState.movementLocked && !unitState.cannotBeStoppedFromMoving) {
        this.emit("move_blocked", { instanceId: unit.instanceId, reason: "movement_locked" });
        continue;
      }
      let destLane = eff.destination === "choice" ? (frame.targets && frame.targets.destination)
        : eff.destination === "card_lane:Piper" ? this.findCardLane("Piper")
        : eff.destination === "actor_lane" ? frame.actorLane
        : eff.destination === "auto_flee" ? ((frame.targets && frame.targets.destination) || this.pickFleeLane(found.lane))
        : eff.destination;
      if (!destLane || destLane === found.lane) continue;
      const destArr = this.state.players[found.seat][laneKey(destLane)];
      if (destArr.length >= LANE_CAP) { this.emit("move_blocked", { instanceId: unit.instanceId, reason: "lane_full" }); continue; }

      const srcArr = this.state.players[found.seat][laneKey(found.lane)];
      const fromLane = found.lane;
      srcArr.splice(found.idx, 1);
      destArr.push(found.unit);
      this.emit("move", { instanceId: unit.instanceId, from: fromLane, to: destLane, wasSelfMoved: eff.target === "self" });

      // If the unit that moved is the actor of this whole action (Syrah a3:
      // "Move to a different lane. Deal 10 Damage to all cards in THAT
      // lane, friend or foe, including self."), keep the shared frame's
      // actorLane in sync so any subsequent effect in the same action's
      // effect list (e.g. the damage op right after this move op) resolves
      // lane-based targets against the unit's NEW lane, not the lane it
      // started the action in.
      if (frame.actorUnit && unit.instanceId === frame.actorUnit.instanceId) {
        frame.actorLane = destLane;
      }

      // Halcyon: "gain 1 HP every time this character moves lanes" — folded
      // into the same passive_continuous block as cannot_be_stopped_from_moving
      // (one passive per card in this schema) and triggered here inline,
      // rather than adding multi-passive support for a single card.
      if (unitState.cannotBeStoppedFromMoving) {
        this.op_heal({ op: "heal", amount: 1, target: "self" }, { actorUnit: found.unit, actorSeat: found.seat, actorLane: destLane, targets: {} });
      }

      // Halcyon: "gain 1 HP every time this character moves lanes" — and any
      // future on_move_self / on_moved_by_other passives — fire here, after
      // the move is committed, with the correct before/after lane in ctx.
      const moveTrigger = eff.target === "self" ? "on_move_self" : "on_moved_by_other";
      this.firePassiveTriggerSingle(found.unit, found.seat, destLane, moveTrigger);
      // Crumbs copying on_move_self (Kirine, Lily, Yukiko) or
      // on_move_self_or_moved (The Shadow — fires on both self and forced moves).
      this.fireBorrowedTrigger(found.unit, found.seat, destLane, moveTrigger, {});
      this.fireBorrowedTrigger(found.unit, found.seat, destLane, "on_move_self_or_moved", {});
      this.cascadeYureLikeTriggers(found.unit, found.seat, fromLane, destLane);
    }
  }

  findCardLane(name) {
    for (const seat of ["1", "2"]) {
      for (const lane of LANES) {
        if (this.state.players[seat][laneKey(lane)].some(function (u) { return u.name === name; })) return lane;
      }
    }
    return null;
  }

  // Yure: "If a character moves into or out of the lane this character is
  // active on, deal 4 Damage towards them." Board-level sweep triggered by
  // any move (self or other), checked against every Yure-like unit present.
  cascadeYureLikeTriggers(movedUnit, movedSeat, fromLane, toLane) {
    for (const seat of ["1", "2"]) {
      for (const lane of LANES) {
        for (const watcher of this.state.players[seat][laneKey(lane)].slice()) {
          if (watcher.instanceId === movedUnit.instanceId) continue;
          const crossedIn = lane === toLane;
          const crossedOut = lane === fromLane;
          if (!crossedIn && !crossedOut) continue;
          // Fire borrowed on_lane_boundary_cross triggers (Crumbs copying Yure)
          this.fireBorrowedTrigger(watcher, seat, lane, "on_lane_boundary_cross", { movedUnit: movedUnit });
          const def = this.cardDef(watcher.name);
          if (!def.passive || def.passive.trigger !== "on_lane_boundary_cross") continue;
          if (hasStatus(watcher, "passive_negated")) continue;
          for (const eff of def.passive.effects) {
            this.runOp(eff, { actorUnit: watcher, actorSeat: seat, actorLane: lane, targets: { singleTarget: movedUnit.instanceId } });
          }
        }
      }
    }
  }

  // ---- status-applying ops ----------------------------------------------

  op_buff_damage(eff, frame) {
    const units = eff.target.indexOf("card_named:") === 0
      ? this.findUnitsByName(eff.target.split(":")[1])
      : this.resolveTargetUnits(eff.target, frame, eff);
    if (eff.condition && !this.checkCondition(eff.condition, frame)) return;
    // Andromeda: "Double any Damage or HP boosts within the lane" — if the
    // CASTER has an ally in their lane granting boostMultiplier, scale the
    // applied amount (not the eventual combat damage twice — this scales the
    // buff itself, matching "damage boosts only affect the first attack"
    // style wording elsewhere being a per-card carve-out, not a general rule).
    const boost = frame.actorUnit ? this.getLaneBoostMultiplier(frame.actorUnit) : 1;
    for (const unit of units) {
      if (!eff.stacks) {
        unit.statuses = unit.statuses.filter(function (s) { return s.kind !== "buff_damage"; });
      }
      addStatus(unit, {
        kind: "buff_damage", amount: (eff.amount || 0) * boost, multiplier: eff.multiplier,
        expires: this.durationToExpiry(eff.duration, frame.actorSeat),
      });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "buff_damage", amount: (eff.amount || 0) * boost, multiplier: eff.multiplier });
    }
  }

  // Returns the Andromeda-style boost multiplier in effect for a caster
  // based on lane-mates (NOT the caster's own boostMultiplier field, which
  // is what Andromeda grants to others — she doesn't double her own boosts
  // per the card text reading "within the lane" referring to allies present).
  getLaneBoostMultiplier(casterUnit) {
    return this.getContinuousState(casterUnit).boostMultiplier;
  }

  op_halve_damage(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      addStatus(unit, { kind: "halve_damage", expires: this.durationToExpiry(eff.duration, frame.actorSeat) });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "halve_damage" });
    }
  }

  op_negate_damage(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      addStatus(unit, { kind: "negate_damage", expires: this.durationToExpiry(eff.duration, frame.actorSeat) });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "negate_damage" });
    }
  }

  op_redirect_damage(eff, frame) {
    addStatus(frame.actorUnit, {
      kind: "redirect_damage",
      expires: this.durationToExpiry(eff.duration, frame.actorSeat),
      meta: { singleTargetOnly: !!eff.singleTargetOnly },
    });
    this.emit("status_applied", { instanceId: frame.actorUnit.instanceId, kind: "redirect_damage" });
  }

  op_disable_actions(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      // "until_their_next_turn" (Kazura a3: "disable their actions for one
      // turn") must expire on the DISABLED UNIT's own next turn, not the
      // caster's — look up the target's actual seat rather than defaulting
      // to frame.actorSeat the way every other duration type does.
      const expiryOwnerSeat = eff.duration === "until_their_next_turn"
        ? (findUnit(this.state, unit.instanceId) || {}).seat || frame.actorSeat
        : frame.actorSeat;
      addStatus(unit, { kind: "disable_actions", expires: this.durationToExpiry(eff.duration, expiryOwnerSeat) });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "disable_actions" });
    }
  }

  // "By your next turn, X" / "At the end of the opponent's next turn, X".
  // Schedules `effects` to run at the described future moment rather than
  // running them now. See schedulePendingEffect/flushPendingEffects.
  op_delayed_effect(eff, frame) {
    const ownerSeat = eff.resolveAt && eff.resolveAt.relativeTo === "opponent" ? this.opponentOf(frame.actorSeat) : frame.actorSeat;
    const resolveAt = { type: (eff.resolveAt && eff.resolveAt.moment) || "turn_start", ownerSeat: ownerSeat };
    this.schedulePendingEffect(frame.actorSeat, resolveAt, eff.effects, frame);
    this.emit("effect_scheduled", { actorInstanceId: frame.actorUnit ? frame.actorUnit.instanceId : null, resolveAt: resolveAt });
  }

  // Gates a nested effect list behind a per-unit once-per-turn flag (Cordelia's
  // free summon, Kazura's negate, Reishi's free-action coin flip, Lucia's a3).
  // `key` namespaces multiple independent gates on the same unit if ever needed.
  op_once_per_turn_gate(eff, frame) {
    const key = eff.key || "default";
    if (frame.actorUnit.counters[key]) {
      this.emit("once_per_turn_blocked", { instanceId: frame.actorUnit.instanceId, key: key });
      return;
    }
    frame.actorUnit.counters[key] = true;
    for (const sub of eff.effects) this.runOp(sub, frame);
  }

  // Ilynn a3: suppress a target's passive for a duration. Implemented as a
  // status that firePassiveTrigger / getContinuousState consult.
  op_negate_passive(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      addStatus(unit, { kind: "passive_negated", expires: this.durationToExpiry(eff.duration, frame.actorSeat) });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "passive_negated" });
    }
  }

  // Tanker: toggles a `mode` flag that the action-lookup step (resolveAction)
  // consults to pick which moveset entry to use.
  op_switch_mode(eff, frame) {
    const def = this.cardDef(frame.actorUnit.name);
    const modes = def.passive.mode.options;
    const idx = modes.indexOf(frame.actorUnit.flags.mode);
    frame.actorUnit.flags.mode = modes[(idx + 1) % modes.length];
    // "Bonuses are removed when switching forms" — clear non-permanent statuses.
    frame.actorUnit.statuses = frame.actorUnit.statuses.filter(function (s) { return s.expires && s.expires.type === "permanent"; });
    this.emit("mode_switch", { instanceId: frame.actorUnit.instanceId, newMode: frame.actorUnit.flags.mode });
  }

  // Damage dealt equal to the actor's current HP (Tanker a3, Vivian a3).
  op_damage_equal_to_self_hp(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    const amount = frame.actorUnit.hp;
    let wasFatal = false;
    for (const unit of units) {
      const result = this.applyDamage(unit, amount, frame.actorUnit, frame.actorSeat, { multiTarget: units.length > 1 || eff.target.indexOf("all_") === 0 });
      if (result && result.wasFatal) wasFatal = true;
    }
    if (eff.onFatalRefund && wasFatal) {
      const p = this.state.players[frame.actorSeat];
      p.energy += frame.spentCost || 0;
      this.emit("energy_change", { seat: frame.actorSeat, amount: frame.spentCost || 0, newTotal: p.energy, reason: "fatal_refund" });
    }
  }

  durationToExpiry(duration, ownerSeat) {
    switch (duration) {
      case "permanent": return { type: "permanent" };
      case "next_attack": return { type: "next_attack" };
      case "this_turn": return { type: "this_turn", ownerSeatAtApply: ownerSeat };
      case "until_their_next_turn":
        // "Disable for one turn" should mean the target is disabled for their
        // ENTIRE next turn, not cleared before they act. We use "until_turn_end"
        // so expireStatusesOnTurnEnd() (called at endTurn) clears it after
        // the target has taken their turn, not expireStatusesOnTurnStart()
        // (which would strip it before they act).
        return { type: "until_turn_end", ownerSeatAtApply: ownerSeat };
      case "until_next_turn":
      default:
        return { type: "until_next_turn", ownerSeatAtApply: ownerSeat };
    }
  }

  findUnitsByName(name) {
    const out = [];
    for (const seat of ["1", "2"]) for (const lane of LANES) {
      for (const u of this.state.players[seat][laneKey(lane)]) if (u.name === name) out.push(u);
    }
    return out;
  }

  // ---- RNG ops ------------------------------------------------------------

  op_coin_flip(eff, frame) {
    const heads = this.rng() < 0.5;
    this.emit("coin_flip", { heads: heads, actorInstanceId: frame.actorUnit ? frame.actorUnit.instanceId : null });
    const branch = heads ? eff.onHeads : eff.onTails;
    for (const sub of branch) this.runOp(sub, frame);
  }

  op_dice_roll(eff, frame) {
    const roll = Math.floor(this.rng() * eff.sides) + 1;
    this.emit("dice_roll", { sides: eff.sides, roll: roll, actorInstanceId: frame.actorUnit ? frame.actorUnit.instanceId : null });
    const nextCtx = Object.assign({}, frame, { ctx: Object.assign({}, frame.ctx || {}, { rollResult: roll }) });
    this.runOp(eff.onResult, nextCtx);
  }

  // ---- misc ops used by the 12-card set -----------------------------------

  op_grant_energy(eff, frame) {
    const targetSeat = eff.target === "self_player" ? frame.actorSeat
      : eff.target === "opp_player" ? this.opponentOf(frame.actorSeat)
      : frame.actorSeat;
    const p = this.state.players[targetSeat];
    // carryover:true means the energy is earned during the opponent's turn
    // and should survive the turn reset (e.g. Nurse Anna's Anaesthetics).
    // Store it on _carryoverEnergy; startTurn() adds it back after the reset.
    if (eff.carryover && this.state.currentTurn !== targetSeat) {
      p._carryoverEnergy = (p._carryoverEnergy || 0) + eff.amount;
      this.emit("energy_change", { seat: targetSeat, amount: eff.amount, newTotal: p.energy, reason: "carryover" });
    } else {
      p.energy = Math.max(0, p.energy + eff.amount);
      this.emit("energy_change", { seat: targetSeat, amount: eff.amount, newTotal: p.energy });
    }
  }

  // Jacie/Venus passive: "grant 1 Energy per opposing card in the lane"
  op_grant_energy_per_opp_in_lane(eff, frame) {
    const oppSeat = this.opponentOf(frame.actorSeat);
    const count = this.state.players[oppSeat][laneKey(frame.actorLane)].length;
    if (count === 0) return;
    this.op_grant_energy({ amount: eff.amount * count, target: eff.target || "self_player" }, frame);
  }

  // Audrey passive: "grant 2 HP to all allies per empty opp slot"
  op_heal_per_empty_opp_slot(eff, frame) {
    const oppSeat = this.opponentOf(frame.actorSeat);
    const filled = this.state.players[oppSeat][laneKey(frame.actorLane)].length;
    const empty = Math.max(0, LANE_CAP - filled);
    if (empty === 0) return;
    const amount = eff.amount * empty;
    for (const ally of this.state.players[frame.actorSeat][laneKey(frame.actorLane)].slice()) {
      // Audrey's card text: "grant 2 HP to all allies" — excludes Audrey herself
      if (ally.instanceId === frame.actorUnit.instanceId) continue;
      const found = findUnit(this.state, ally.instanceId);
      if (!found) continue;
      const before = found.unit.hp;
      found.unit.hp += amount;
      this.emit("heal", { instanceId: ally.instanceId, amount: amount, before: before, after: found.unit.hp, temporary: false });
    }
  }

  // Aichmo passive: "+N damage per opp in lane each turn, stacking permanently"
  op_buff_damage_per_opp_in_lane(eff, frame) {
    const oppSeat = this.opponentOf(frame.actorSeat);
    const count = this.state.players[oppSeat][laneKey(frame.actorLane)].length;
    if (count === 0) return;
    const gain = eff.amount * count;
    addStatus(frame.actorUnit, { kind: "buff_damage", amount: gain, expires: { type: "permanent" } });
    this.emit("status_applied", { instanceId: frame.actorUnit.instanceId, kind: "buff_damage", amount: gain });
  }

  // Ninaki a2: "Gain N HP per enemy in lane, temporary"
  op_heal_per_opp_in_lane(eff, frame) {
    const oppSeat = this.opponentOf(frame.actorSeat);
    const count = this.state.players[oppSeat][laneKey(frame.actorLane)].length;
    if (count === 0) return;
    this.op_heal({ amount: eff.amount * count, target: eff.target || "self", temporary: !!eff.temporary }, frame);
  }

  // Nurse Anna a3: "Grant N HP to all lane allies per own HP. Defeat self."
  op_heal_all_allies_per_own_hp(eff, frame) {
    const hp = frame.actorUnit.hp;
    if (hp <= 0) return;
    const amount = eff.amount * hp;
    for (const ally of this.state.players[frame.actorSeat][laneKey(frame.actorLane)].slice()) {
      if (ally.instanceId === frame.actorUnit.instanceId) continue;
      const found = findUnit(this.state, ally.instanceId);
      if (!found) continue;
      const before = found.unit.hp;
      found.unit.hp += amount;
      this.emit("heal", { instanceId: ally.instanceId, amount: amount, before: before, after: found.unit.hp, temporary: false });
    }
  }

  // Jacie a3: "Double current HP" — heals self by current HP amount, temporary
  op_heal_double_current(eff, frame) {
    const unit = frame.actorUnit;
    const amount = unit.hp;
    if (amount <= 0) return;
    unit.hp += amount;
    this.emit("heal", { instanceId: unit.instanceId, amount: amount, before: unit.hp - amount, after: unit.hp, temporary: true });
    addStatus(unit, { kind: "temp_heal_rollback", amount: amount, expires: { type: "until_next_turn", ownerSeatAtApply: frame.actorSeat } });
  }

  // Aegon a3: apply a one-shot reflect status consumed in applyDamage
  op_apply_reflect_once(eff, frame) {
    addStatus(frame.actorUnit, { kind: "reflect_next_hit", expires: this.durationToExpiry(eff.duration || "until_next_turn", frame.actorSeat) });
    this.emit("status_applied", { instanceId: frame.actorUnit.instanceId, kind: "reflect_next_hit" });
  }

  // Crumbs passive: copy chosen ally's passive and fire it as Crumbs
  op_copy_passive(eff, frame) {
    const choiceId = frame.targets && frame.targets.copySourceInstanceId;
    if (!choiceId) return;
    const found = findUnit(this.state, choiceId);
    if (!found || found.seat !== frame.actorSeat || found.lane !== frame.actorLane) return;
    const sourceDef = this.cardDef(found.unit.name);
    if (!sourceDef.passive) return;
    const pd = sourceDef.passive;
    const crumbs = frame.actorUnit;
    const oppSeat = this.opponentOf(frame.actorSeat);
    // Expires at the END of the opponent's next turn
    const expiry = { type: "until_turn_end", ownerSeatAtApply: oppSeat };
    this.emit("copy_passive", { actorInstanceId: crumbs.instanceId, sourceInstanceId: choiceId, sourceName: found.unit.name });

    // Store the source name on Crumbs' flags so the UI can show what was copied
    crumbs.flags.copiedPassiveName = found.unit.name;

    if (pd.trigger === "passive_continuous") {
      for (const e of pd.effects) {
        addStatus(crumbs, {
          kind: "borrowed_passive_op",
          meta: e,
          expires: expiry,
        });
      }
      this.emit("status_applied", { instanceId: crumbs.instanceId, kind: "borrowed_passive_op", sourceName: found.unit.name });

    } else if (pd.trigger === "on_place") {
      this.runPassiveEffects(crumbs, frame.actorSeat, frame.actorLane, sourceDef, {});

    } else if (pd.trigger === "on_turn_start" || pd.trigger === "on_turn_start_self_cost") {
      this.runPassiveEffects(crumbs, frame.actorSeat, frame.actorLane, sourceDef, {});
      addStatus(crumbs, {
        kind: "borrowed_passive_trigger",
        meta: { passiveData: pd, sourceName: found.unit.name },
        expires: expiry,
      });
      this.emit("status_applied", { instanceId: crumbs.instanceId, kind: "borrowed_passive_trigger", sourceName: found.unit.name });

    } else {
      addStatus(crumbs, {
        kind: "borrowed_passive_trigger",
        meta: { passiveData: pd, sourceName: found.unit.name },
        expires: expiry,
      });
      this.emit("status_applied", { instanceId: crumbs.instanceId, kind: "borrowed_passive_trigger", sourceName: found.unit.name });
    }
  }

  // Fire any borrowed_passive_trigger statuses matching the given trigger event.
  fireBorrowedTrigger(unit, seat, lane, trigger, ctx) {
    if (!unit.statuses) return;
    for (const s of unit.statuses.filter(function(st) { return st.kind === "borrowed_passive_trigger"; })) {
      const pd = s.meta.passiveData;
      if (pd.trigger !== trigger) continue;
      // on_turn_start and on_turn_start_self_cost only fire on the unit's OWN seat's turn
      if ((pd.trigger === "on_turn_start" || pd.trigger === "on_turn_start_self_cost") && ctx && ctx.seat && ctx.seat !== seat) continue;
      // on_turn_end_zero_energy only fires for the seat whose turn is ending
      if (pd.trigger === "on_turn_end_zero_energy" && ctx && ctx.seat && ctx.seat !== seat) continue;

      // on_attacked passives have special routing that must mirror maybeOnAttacked:
      // - damage ops target the attacker (not the defender)
      // - move ops with destination:"choice" defer to the UI lane picker
      // - move ops with destination:"auto_flee" execute immediately
      if (pd.trigger === "on_attacked") {
        var attacker = ctx && ctx.attacker;
        var multiTarget = ctx && ctx.multiTarget;
        var found = findUnit(this.state, unit.instanceId);
        if (!found) continue;
        for (const eff of pd.effects) {
          if (eff.op === "damage") {
            if (attacker) {
              this.runOp(eff, { actorUnit: unit, actorSeat: found.seat, actorLane: found.lane, targets: { singleTarget: attacker.instanceId } });
            }
          } else if (eff.op === "move") {
            if (eff.destination === "choice") {
              unit.flags.pendingPassiveMove = true;
              this.emit("passive_move_pending", {
                instanceId: unit.instanceId,
                cardName: unit.name,
                seat: found.seat,
                currentLane: found.lane,
              });
            } else {
              this.runOp(eff, { actorUnit: unit, actorSeat: found.seat, actorLane: found.lane, targets: {} });
            }
          } else if (eff.op === "flag_next_attack_bonus") {
            if (!multiTarget) {
              addStatus(unit, {
                kind: "buff_damage", amount: eff.amount || 0, multiplier: eff.multiplier,
                expires: { type: "next_attack" },
              });
            }
          } else {
            this.runOp(eff, { actorUnit: unit, actorSeat: found.seat, actorLane: found.lane, targets: {} });
          }
        }
        continue;
      }

      var fakeDef = { passive: pd };
      this.runPassiveEffects(unit, seat, lane, fakeDef, ctx || {});
    }
  }

  // Reishi's coin-flip / Shelby's & Vivian's zero-energy passives: marks the
  // unit's NEXT action as free, consumed generically in resolveAction().
  op_grant_free_next_action(eff, frame) {
    frame.actorUnit.flags.nextActionFree = true;
    this.emit("status_applied", { instanceId: frame.actorUnit.instanceId, kind: "next_action_free" });
  }

  // Red ("moves to a lane with at least 1 other character active", once per
  // turn) / The Shadow ("moves or is moved to a lane with no other characters
  // active") — both react to the unit's OWN current lane population right
  // after a move. `condition` is "populated" or "empty"; `oncePerTurn` gates
  // Red specifically.
  op_grant_energy_if_lane_population(eff, frame) {
    const seat = frame.actorSeat, lane = frame.actorLane;
    const populationExcludingSelf = this.state.players["1"][laneKey(lane)].length
      + this.state.players["2"][laneKey(lane)].length - 1;
    const matches = eff.condition === "populated" ? populationExcludingSelf >= 1 : populationExcludingSelf === 0;
    if (!matches) return;
    if (eff.oncePerTurn) {
      if (frame.actorUnit.counters.redEnergyUsed) return;
      frame.actorUnit.counters.redEnergyUsed = true;
    }
    this.op_grant_energy({ amount: eff.amount, target: "self_player" }, frame);
  }

  op_defeat(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) this.defeatUnit(unit.instanceId, frame.actorUnit);
  }

  defeatUnit(instanceId, byUnit, opts) {
    opts = opts || {};
    const found = findUnit(this.state, instanceId);
    if (!found) return false;
    const unit = found.unit, seat = found.seat, lane = found.lane, idx = found.idx;
    const def = this.cardDef(unit.name);
    // Re-entrancy guard: Iridia's on_defeat_self fires before she is spliced
    // out of the board, so all_in_lane includes her. If her HP is already 0
    // and she is mid-defeat (flag set below), a second defeatUnit call for
    // her would cause infinite recursion. The flag is set just before the
    // passive fires and cleared if she somehow survives (Miles revival path).
    if (unit.flags._midDefeat) return false;
    unit.flags._midDefeat = true;

    // Lucia: "can only be defeated with an attack that will result in
    // exactly 0 HP" — overkill damage that would take her below 0 instead
    // just clamps her at 1 HP and she survives. Checked here (rather than
    // in applyDamage) so direct `defeat` ops (Wheelie a3, etc.) still work
    // normally — only HP-driven defeats are gated. `opts.exactLethalCheck`
    // is passed true only from the HP-loss path in applyDamage.
    if (opts.exactLethalCheck && def.passive && def.passive.trigger === "passive_continuous" &&
        !hasStatus(unit, "passive_negated")) {
      const exactOnly = def.passive.effects.some(function (e) { return e.op === "defeat_requires_exact_zero"; });
      if (exactOnly && opts.overkill) {
        unit.hp = 1;
        this.emit("survive_overkill", { instanceId: instanceId, reason: "lucia_exact_lethal_only" });
        return false;
      }
    }

    if (def.passive && def.passive.trigger === "on_defeat_self" && def.passive.onceEver && !unit.flags.revivedOnce) {
      unit.flags.revivedOnce = true;
      unit.flags._midDefeat = false; // clear re-entrancy guard since unit survived
      unit.hp = this.getEffectiveMaxHp(unit);
      this.emit("revive", { instanceId: instanceId });
      for (const eff of def.passive.effects) {
        if (eff.op === "revive") continue;
        // For on_defeat_self passive moves (Miles: "move to a different lane"),
        // destination:"choice" needs a target but there is no picker UI in
        // the passive fire path. Supply pickFleeLane as the automatic default
        // so Miles actually moves; a toast will tell both players where he went.
        const passiveTargets = eff.op === "move" && eff.destination === "choice"
          ? { destination: this.pickFleeLane(lane) }
          : {};
        const didMove = eff.op === "move";
        const destForToast = passiveTargets.destination;
        this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: passiveTargets, isPassive: true });
        if (didMove && destForToast) {
          this.emit("auto_move_notice", { seat: seat, cardName: unit.name, from: lane, to: destForToast, reason: "passive_revive" });
        }
      }
      // The attack that triggered this WAS fatal (it reduced HP to 0) even
      // though Miles's own ability intercepts and revives — the attacker's
      // "if fatal" hooks should still fire, since the kill genuinely landed.
      return true;
    }

    // Iridia-style "when defeated, deal area damage" — must fire BEFORE the
    // unit is removed from the board, since the effect needs actorLane.
    if (def.passive && def.passive.trigger === "on_defeat_self" && !def.passive.onceEver) {
      for (const eff of def.passive.effects) {
        // summon_free from a defeat passive: if the player has cards to choose from,
        // defer to a UI picker (passive_summon_pending) rather than auto-picking hand[0].
        if (eff.op === "summon_free") {
          const hand = this.state.players[seat].hand;
          if (hand.length === 0) continue; // nothing to summon
          if (hand.length === 1) {
            // Only one option — auto-summon it, no choice needed
            this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: {}, isPassive: true });
          } else {
            // Multiple options — emit an event so the UI can show a picker
            this.emit("passive_summon_pending", { seat: seat, cardName: unit.name, actorLane: lane });
          }
        } else {
          this.runOp(eff, { actorUnit: unit, actorSeat: seat, actorLane: lane, targets: {}, isPassive: true });
        }
      }
    }

    this.state.players[seat][laneKey(lane)].splice(idx, 1);
    this.state.players[seat].graveyard.push(unit.name);
    this.emit("defeat", { instanceId: instanceId, name: unit.name, seat: seat, lane: lane });

    if (byUnit) {
      const byFound = findUnit(this.state, byUnit.instanceId);
      if (byFound) this.firePassiveTriggerSingle(byFound.unit, byFound.seat, byFound.lane, "on_defeat_by_self");
    }

    // "Free when any character is defeated, friend or foe" (Arlukino's
    // Overshadow, and any future card with the same op) — board-wide
    // observer. Any defeat (this one included) sets a one-shot free-summon
    // flag for cards in hand carrying free_summon_self_on_any_defeat. Only
    // meaningful pre-summon (irrelevant once already on board).
    this.applyFreeSummonOnAnyDefeat();

    // Borrowed passive triggers
    if (byUnit) {
      const aFound = findUnit(this.state, byUnit.instanceId);
      if (aFound) this.fireBorrowedTrigger(byUnit, aFound.seat, aFound.lane, "on_defeat_by_self", { defeated: unit });
    }
    this.fireBorrowedTrigger(unit, seat, lane, "on_defeat_self", { lane: lane });
    this.cascadeLinkedDefeats(unit.name, seat);
    return true;
  }

  applyFreeSummonOnAnyDefeat() {
    for (const seat of ["1", "2"]) {
      const p = this.state.players[seat];
      p._freeSummonCards = p._freeSummonCards || {};
      for (const cardName of p.hand) {
        const def = this.cardDef(cardName);
        if (def.passive && def.passive.trigger === "passive_continuous" &&
          def.passive.effects.some(function (e) { return e.op === "free_summon_self_on_any_defeat"; })) {
          p._freeSummonCards[cardName] = true;
        }
      }
    }
  }

  firePassiveTriggerSingle(unit, seat, lane, trigger) {
    const def = this.cardDef(unit.name);
    if (!def.passive || def.passive.trigger !== trigger) return;
    this.runPassiveEffects(unit, seat, lane, def, {});
  }

  cascadeLinkedDefeats(defeatedName, defeatedSeat) {
    // Only cascade within the SAME seat: Linnaeus should die when his OWN
    // team's Piper is defeated, not the opponent's. Also, per card ruling,
    // "disabled" does NOT count as unusable — only being off the board does.
    for (const lane of LANES) {
      for (const unit of this.state.players[defeatedSeat][laneKey(lane)].slice()) {
        const def = this.cardDef(unit.name);
        if (!def.passive || def.passive.trigger !== "passive_continuous") continue;
        for (const eff of def.passive.effects) {
          if (eff.op === "linked_lifecycle" && eff.linkedTo === defeatedName) {
            this.defeatUnit(unit.instanceId, null);
          }
        }
      }
    }
  }

  // ---- Domi / hand-manipulation -------------------------------------------

  op_view_hand(eff, frame) {
    const seat = eff.target === "opponent" ? this.opponentOf(frame.actorSeat) : frame.actorSeat;
    this.emit("view_hand", { byseat: frame.actorSeat, viewedSeat: seat, hand: this.state.players[seat].hand.slice() });
  }

  op_modify_summon_cost(eff, frame) {
    const seat = this.opponentOf(frame.actorSeat);
    const targetCard = frame.targets && frame.targets.handCardChoice;
    if (!targetCard) return;
    this.state.players[seat]._costModifiers = this.state.players[seat]._costModifiers || {};
    this.state.players[seat]._costModifiers[targetCard] = (this.state.players[seat]._costModifiers[targetCard] || 0) + eff.delta;
    this.emit("cost_modified", { seat: seat, card: targetCard, delta: eff.delta });
  }

  effectiveCost(seat, cardName) {
    const def = this.cardDef(cardName);
    const mods = this.state.players[seat]._costModifiers;
    const mod = (mods && mods[cardName]) || 0;
    return Math.max(0, def.cost + mod);
  }

  // ---- Crumbs: copy ability -----------------------------------------------

  op_copy_ability(eff, frame) {
    const choiceId = frame.targets && frame.targets.copySourceInstanceId;
    if (!choiceId) return;
    const found = findUnit(this.state, choiceId);
    if (!found || found.seat !== frame.actorSeat || found.lane !== frame.actorLane) return;
    const sourceDef = this.cardDef(found.unit.name);
    const actionIdx = (frame.targets && frame.targets.copyActionIndex !== undefined) ? frame.targets.copyActionIndex : 0;
    const action = sourceDef.actions[actionIdx];
    if (!action) return;
    this.emit("copy_ability", { actorInstanceId: frame.actorUnit.instanceId, sourceInstanceId: choiceId, actionIndex: actionIdx });
    for (const sub of action.effects) {
      this.runOp(sub, Object.assign({}, frame, { targets: (frame.targets && frame.targets.copiedTargets) || frame.targets }));
    }
  }

  op_trigger_passive_again(eff, frame) {
    const def = this.cardDef(frame.actorUnit.name);
    if (!def.passive) return;
    this.runPassiveEffects(frame.actorUnit, frame.actorSeat, frame.actorLane, def, {});
  }

  op_lock_movement(eff, frame) { /* handled declaratively via isLockedByDomi at move time */ }
  op_free_summon_if(eff, frame) { /* handled by checkLinkedSummons */ }
  op_linked_lifecycle(eff, frame) { /* handled by cascadeLinkedDefeats */ }
  op_modify_max_hp(eff, frame) { /* handled by getEffectiveMaxHp */ }
  op_damage_immunity_unless(eff, frame) { /* handled inline in applyDamage */ }
  op_damage_immunity_if_ally_count_in_lane(eff, frame) { /* handled inline in applyContinuousEffect (Peggy) */ }
  op_reflect_damage(eff, frame) { /* handled inline in applyDamage/maybeReflect */ }
  op_revive(eff, frame) { /* handled inline in defeatUnit */ }

  // The Shadow a3: "Take a card from your opponent's hand and add them to
  // your hand. Only works once." The once-only gate is enforced by the
  // caller wrapping this in op_once_per_turn_gate... actually "only once
  // EVER" per the card text, so it's gated via a unit flag instead.
  op_steal_card(eff, frame) {
    if (frame.actorUnit.flags.stoleCard) {
      this.emit("steal_blocked", { instanceId: frame.actorUnit.instanceId, reason: "already_used" });
      return;
    }
    const oppSeat = this.opponentOf(frame.actorSeat);
    const opp = this.state.players[oppSeat];
    const choiceIdx = frame.targets && frame.targets.stealCardIndex !== undefined
      ? frame.targets.stealCardIndex
      : (opp.hand.length ? 0 : -1);
    if (choiceIdx < 0 || choiceIdx >= opp.hand.length) return;
    const card = opp.hand.splice(choiceIdx, 1)[0];
    this.state.players[frame.actorSeat].hand.push(card);
    frame.actorUnit.flags.stoleCard = true;
    this.emit("card_stolen", { byInstanceId: frame.actorUnit.instanceId, card: card, fromSeat: oppSeat });
  }

  // ---- declarative no-op markers ------------------------------------------
  // These ops carry data consulted elsewhere (getContinuousState, summon(),
  // applyDamage, etc.) rather than executing inline. Registered here so
  // runOp() never warns "unhandled op" if a future code path ever scans a
  // passive's effect list generically. See the comment on each call site
  // (grep the op name) for where the real logic lives.
  op_damage_taken_once_per_turn(eff, frame) { /* handled inline in applyDamage */ }
  op_block_summons_in_lane(eff, frame) { /* handled by isLaneSummonBlockedByCarmella */ }
  op_ban_opponent_summon_in_lane(eff, frame) { /* handled by applyOnPlaceLaneBans */ }
  op_cannot_be_moved(eff, frame) { /* handled inline in op_move via getContinuousState */ }
  op_cannot_be_stopped_from_moving(eff, frame) { /* handled inline in op_move via getContinuousState */ }
  op_boost_allies_in_lane(eff, frame) { /* handled inline in op_buff_damage/op_heal via getLaneBoostMultiplier */ }
  op_free_summon_per_turn(eff, frame) { /* handled by findActiveUnitGrantingFreeSummon + summon() opt-in */ }
  op_defeat_requires_exact_zero(eff, frame) { /* handled inline in defeatUnit (Lucia) */ }
  op_mode_definition(eff, frame) { /* consulted via lookupAction()/op_switch_mode, not executed */ }

  // Generic if/else wrapper used throughout Phase 2 cards (Gunpowder a3,
  // Iridia a3, Lilith passive, etc.) — runs `then` effects if the condition
  // holds, otherwise `else` effects (if provided).
  op_conditional(eff, frame) {
    const ctx = { actorSeat: frame.actorSeat, actorLane: frame.actorLane };
    const holds = this.checkCondition(eff.condition, ctx);
    const branch = holds ? eff.then : eff.else;
    if (!branch) return;
    for (const sub of branch) this.runOp(sub, frame);
  }

  // "Summon a character for free" (Cordelia a3, Postman Mortem passive/a3) —
  // player chooses which hand card to summon via targets.summonCardChoice
  // and targets.summonLaneChoice. Falls back to the first hand card / actor's
  // own lane if not explicitly supplied — this happens when the op fires from
  // a passive (e.g. Postman Mortem's on_defeat_self) rather than from a
  // player-driven action button where the picker dialog already ran.
  // In the passive/auto case we emit a clear "auto_summon" toast so both
  // players can see what was silently summoned and where.
  op_summon_free(eff, frame) {
    const seat = frame.actorSeat;
    const p = this.state.players[seat];
    const hadPickerInput = !!(frame.targets && frame.targets.summonCardChoice);
    const cardName = (frame.targets && frame.targets.summonCardChoice) || p.hand[0];
    if (!cardName) return; // empty hand, nothing to summon
    const lane = (frame.targets && frame.targets.summonLaneChoice) || frame.actorLane;
    try {
      this.summon(seat, cardName, lane, { free: true });
      // When the summon happened silently (no picker — passive trigger), notify
      // both players so the unexpected board change isn't a mystery.
      if (!hadPickerInput) {
        this.emit("auto_summon_notice", { seat: seat, cardName: cardName, lane: lane, reason: "passive" });
      }
    } catch (e) {
      this.emit("summon_free_failed", { seat: seat, cardName: cardName, lane: lane, reason: e.message });
    }
  }

  // Cinwicke/Delici: "Apply this card's Passive Ability to an ally in the
  // lane. This effect is removed by your next turn." Grants a temporary
  // status carrying just enough data for getContinuousState's borrowed-pass
  // to fold the named op in as if self-sourced on the target.
  op_grant_passive_copy(eff, frame) {
    const units = this.resolveTargetUnits(eff.target, frame, eff);
    for (const unit of units) {
      addStatus(unit, {
        kind: "borrowed_passive_op",
        meta: { op: eff.passiveOp, amount: eff.amount, exception: eff.exception },
        expires: this.durationToExpiry(eff.duration, frame.actorSeat),
      });
      this.emit("status_applied", { instanceId: unit.instanceId, kind: "borrowed_passive_op", passiveOp: eff.passiveOp });
    }
  }

  op_negate_damage_immediate(eff, frame) { /* only consumed inline within maybeOnAttacked's branch handling, never dispatched generically */ }
  op_damage_dealt_per_enemy_in_lane(eff, frame) { /* handled inline in applyContinuousEffect (Chloe) */ }
  op_damage_dealt_per_card_in_lane(eff, frame) { /* handled inline in applyContinuousEffect (Orina) */ }
  op_disable_lane_except_self(eff, frame) { /* handled inline in applyContinuousEffect + resolveAction gate (Ellie Ember) */ }
  op_free_summon_self_on_any_defeat(eff, frame) { /* handled by applyFreeSummonOnAnyDefeat + summon() opt-in (Arlukino) */ }
  op_splash_adjacent_lanes_marker(eff, frame) { /* declarative marker only; real splash logic lives in op_damage's splashAdjacent param (Delici) */ }
  op_heal_allies_in_lane_continuous(eff, frame) { /* superseded — Selene modeled via on_turn_start heal instead, kept as defensive stub */ }
}
