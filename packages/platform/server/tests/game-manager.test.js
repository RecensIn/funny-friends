import { describe, it, expect } from 'vitest';

const { evaluateHand, compareHands, createDeck, shuffleDeck } = require('../game/GameManager');

describe('GameManager — Hand Evaluation', () => {
  describe('evaluateHand', () => {
    it('detects Trail (three of a kind)', () => {
      const hand = [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: 'A', value: 14 },
        { suit: '♦', rank: 'A', value: 14 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(6);
    });

    it('detects Pure Sequence', () => {
      const hand = [
        { suit: '♥', rank: 'A', value: 14 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♥', rank: 'Q', value: 12 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(5);
    });

    it('detects Sequence (different suits)', () => {
      const hand = [
        { suit: '♠', rank: '5', value: 5 },
        { suit: '♥', rank: '4', value: 4 },
        { suit: '♦', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(4);
    });

    it('detects A-2-3 as Sequence', () => {
      const hand = [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: '3', value: 3 },
        { suit: '♦', rank: '2', value: 2 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(4);
    });

    it('detects Color (same suit, no sequence)', () => {
      const hand = [
        { suit: '♣', rank: 'K', value: 13 },
        { suit: '♣', rank: '9', value: 9 },
        { suit: '♣', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(3);
    });

    it('detects Pair', () => {
      const hand = [
        { suit: '♠', rank: 'J', value: 11 },
        { suit: '♥', rank: 'J', value: 11 },
        { suit: '♦', rank: '7', value: 7 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(2);
    });

    it('detects High Card', () => {
      const hand = [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: '9', value: 9 },
        { suit: '♦', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(1);
    });
  });

  describe('compareHands', () => {
    it('Trail beats Sequence', () => {
      const trail = evaluateHand([
        { suit: '♠', rank: '2', value: 2 },
        { suit: '♥', rank: '2', value: 2 },
        { suit: '♦', rank: '2', value: 2 },
      ]);
      const sequence = evaluateHand([
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♦', rank: 'Q', value: 12 },
      ]);
      expect(compareHands(trail, sequence)).toBeGreaterThan(0);
    });

    it('Higher Pair beats lower Pair', () => {
      const highPair = evaluateHand([
        { suit: '♠', rank: 'K', value: 13 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♦', rank: '3', value: 3 },
      ]);
      const lowPair = evaluateHand([
        { suit: '♠', rank: '5', value: 5 },
        { suit: '♥', rank: '5', value: 5 },
        { suit: '♦', rank: 'A', value: 14 },
      ]);
      expect(compareHands(highPair, lowPair)).toBeGreaterThan(0);
    });
  });

  describe('createDeck', () => {
    it('creates 52 unique cards', () => {
      const deck = createDeck();
      expect(deck.length).toBe(52);
      const keys = new Set(deck.map(c => `${c.suit}-${c.rank}`));
      expect(keys.size).toBe(52);
    });
  });

  describe('shuffleDeck', () => {
    it('returns same number of cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      expect(shuffled.length).toBe(52);
    });

    it('does not mutate original deck', () => {
      const deck = createDeck();
      const original = [...deck];
      shuffleDeck(deck);
      expect(deck).toEqual(original);
    });
  });
});
