import { describe, it, expect, beforeEach } from 'vitest';

const RummyLedger = require('../game/rummy/GameManager');

describe('RummyLedger', () => {
  let ledger;

  beforeEach(() => {
    ledger = new RummyLedger({
      sessionId: 1, sessionName: 'test-rummy',
      gameLimitType: 'points', targetScore: 100, totalRounds: 10
    });
    ledger.setPlayers([
      { id: 1, name: 'Alice', sessionBalance: 0, seat: 1 },
      { id: 2, name: 'Bob', sessionBalance: 0, seat: 2 },
      { id: 3, name: 'Charlie', sessionBalance: 0, seat: 3 },
    ]);
    ledger.currentRound = 1;
  });

  describe('startRound', () => {
    it('sets phase to ACTIVE and clears round scores', () => {
      ledger.startRound();
      const state = ledger.getPublicState();
      expect(state.phase).toBe('ACTIVE');
      expect(ledger.gameState.players.every(p => p.roundScore === 0)).toBe(true);
    });

    it('rejects start with less than 2 players', () => {
      ledger.setPlayers([{ id: 1, name: 'Alice', sessionBalance: 0, seat: 1 }]);
      const result = ledger.startRound();
      expect(result.success).toBe(false);
    });

    it('emits session_ended when max rounds exceeded', () => {
      ledger.currentRound = 11;
      ledger.totalRounds = 10;
      let emitted = null;
      ledger.once('session_ended', (data) => { emitted = data; });
      const result = ledger.startRound();
      expect(result.success).toBe(false);
      expect(emitted).not.toBeNull();
      expect(emitted.reason).toBe('MAX_ROUNDS_REACHED');
    });
  });

  describe('recordInitialDrop', () => {
    beforeEach(() => ledger.startRound());

    it('adds 20 points to player', () => {
      const result = ledger.recordInitialDrop(1);
      expect(result.success).toBe(true);
      expect(result.points).toBe(20);
      expect(ledger.gameState.players.find(p => p.id === 1).score).toBe(20);
    });

    it('fails for non-existent player', () => {
      const result = ledger.recordInitialDrop(999);
      expect(result.success).toBe(false);
    });

    it('fails if no round in progress', () => {
      ledger.gameState.roundInProgress = false;
      const result = ledger.recordInitialDrop(1);
      expect(result.success).toBe(false);
    });
  });

  describe('recordValidShow', () => {
    beforeEach(() => ledger.startRound());

    it('declares rummy and enters completion phase', () => {
      const result = ledger.recordValidShow(1);
      expect(result.success).toBe(true);
      expect(ledger.gameState.roundCompletionPhase).toBe(true);
      expect(ledger.gameState.rummyDeclaredBy.id).toBe(1);
    });
  });

  describe('recordWrongShow', () => {
    beforeEach(() => ledger.startRound());

    it('adds 80 point penalty', () => {
      ledger.recordWrongShow(1);
      const player = ledger.gameState.players.find(p => p.id === 1);
      expect(player.score).toBe(80);
    });
  });

  describe('checkElimination', () => {
    it('eliminates player when score exceeds target', () => {
      ledger.startRound();
      const player = ledger.gameState.players.find(p => p.id === 1);
      player.score = 101;
      ledger.checkElimination(player);
      expect(player.status).toBe('ELIMINATED');
    });

    it('does not eliminate player at target score exactly', () => {
      ledger.startRound();
      const player = ledger.gameState.players.find(p => p.id === 1);
      player.score = 100;
      ledger.checkElimination(player);
      expect(player.status).toBe('PLAYING');
    });
  });
});
