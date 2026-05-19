const EventEmitter = require('events');

const HAND_RANKINGS = {
    TRAIL: 6,
    PURE_SEQUENCE: 5,
    SEQUENCE: 4,
    COLOR: 3,
    PAIR: 2,
    HIGH_CARD: 1
};

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank, value: RANKS.indexOf(rank) + 2 });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function evaluateHand(cards) {
    const sorted = [...cards].sort((a, b) => b.value - a.value);
    const [c1, c2, c3] = sorted;
    
    if (c1.value === c2.value && c2.value === c3.value) {
        return { rank: HAND_RANKINGS.TRAIL, value: c1.value, cards: sorted };
    }
    
    const isSequence = (c1.value - c2.value === 1 && c2.value - c3.value === 1) || 
                       (c1.rank === 'A' && c2.rank === '2' && c3.rank === '3');
    const isSameSuit = c1.suit === c2.suit && c2.suit === c3.suit;
    
    if (isSameSuit && isSequence) {
        return { rank: HAND_RANKINGS.PURE_SEQUENCE, value: c1.value, cards: sorted };
    }
    
    if (isSequence) {
        return { rank: HAND_RANKINGS.SEQUENCE, value: c1.value, cards: sorted };
    }
    
    if (isSameSuit) {
        return { rank: HAND_RANKINGS.COLOR, value: c1.value, cards: sorted };
    }
    
    if (c1.value === c2.value) {
        return { rank: HAND_RANKINGS.PAIR, value: c1.value * 100 + c3.value, cards: sorted };
    }
    if (c2.value === c3.value) {
        return { rank: HAND_RANKINGS.PAIR, value: c2.value * 100 + c1.value, cards: sorted };
    }
    
    return { rank: HAND_RANKINGS.HIGH_CARD, value: c1.value * 10000 + c2.value * 100 + c3.value, cards: sorted };
}

function compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
        return hand1.rank - hand2.rank;
    }
    return hand1.value - hand2.value;
}

class GameManager extends EventEmitter {
    constructor(config, sessionName, totalRounds) {
        super();
        
        if (typeof config === 'object' && config !== null) {
            this.sessionId = config.sessionId;
            this.sessionName = config.sessionName;
            this.gameLimitType = config.gameLimitType || 'rounds';
            this.totalRounds = config.totalRounds;
            this.targetScore = config.targetScore;
        } else {
            this.sessionId = config;
            this.sessionName = sessionName;
            this.totalRounds = totalRounds;
            this.gameLimitType = 'rounds';
        }
        
        this.currentRound = 1;
        this.isActive = true;

        this.gameState = {
            players: [],
            pot: 0,
            currentStake: 20,
            activePlayerIndex: 0,
            gamePlayers: [],
            currentLogs: [],
            phase: 'SETUP',
            sideShowRequest: null,
            showRequest: null,
            gameLimitType: this.gameLimitType,
            totalRounds: this.totalRounds,
            targetScore: this.targetScore,
            recoveredFromCrash: false
        };
        
        this.requestTimeouts = new Map();
        this.REQUEST_TIMEOUT_MS = 60000;
    }
    
    clearRequestTimeouts() {
        for (const [key, timeoutId] of this.requestTimeouts) {
            clearTimeout(timeoutId);
        }
        this.requestTimeouts.clear();
    }
    
    setRequestTimeout(requestType, callback) {
        if (this.requestTimeouts.has(requestType)) {
            clearTimeout(this.requestTimeouts.get(requestType));
        }
        
        const timeoutId = setTimeout(() => {
            this.requestTimeouts.delete(requestType);
            callback();
        }, this.REQUEST_TIMEOUT_MS);
        
        this.requestTimeouts.set(requestType, timeoutId);
    }

    setPlayers(initialPlayers) {
        this.gameState.players = initialPlayers.map(p => ({
            ...p,
            status: p.status || 'BLIND',
            folded: false,
            invested: 0
        }));
        if (!this.gameState.phase || this.gameState.phase === 'SETUP') {
            this.gameState.phase = 'SETUP';
        }
    }

    addPlayer(player) {
        if (this.gameState.phase !== 'SETUP') return false;
        this.gameState.players.push({
            ...player,
            status: 'BLIND',
            folded: false,
            invested: 0
        });
        return true;
    }

    removePlayer(playerId) {
        // Find player in the main players array
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return false;
        
        const player = this.gameState.players[playerIndex];
        
        if (this.gameState.phase === 'SETUP') {
            // Simple removal during setup
            this.gameState.players.splice(playerIndex, 1);
            // Also remove from gamePlayers if present
            this.gameState.gamePlayers = this.gameState.gamePlayers.filter(p => p.id !== playerId);
            this.emit('state_change', this.getPublicState());
            return true;
        }
        
        // ACTIVE phase: mark as LEFT and fold immediately
        player.status = 'LEFT';
        player.folded = true;
        
        // Also mark in gamePlayers if present
        const gamePlayer = this.gameState.gamePlayers.find(p => p.id === playerId);
        if (gamePlayer) {
            gamePlayer.status = 'LEFT';
            gamePlayer.folded = true;
        }
        
        this.gameState.currentLogs.push(`${player.name} left the game. Their invested amount stays in the pot.`);
        
        // Check if only one player remains active
        const remaining = this.gameState.gamePlayers.filter(p => !p.folded && p.status !== 'LEFT');
        if (remaining.length === 1) {
            this.endHand(remaining[0]);
        } else if (remaining.length === 0) {
            // Edge case: everyone left, end hand with no winner (pot stays for next round)
            this.gameState.currentLogs.push('All players have left. Hand ends with no winner.');
            this.gameState.phase = 'SHOWDOWN';
            this.emit('hand_complete', {
                winner: null,
                pot: this.gameState.pot,
                netChanges: {},
                currentRound: this.currentRound,
                isSessionOver: this.currentRound > this.totalRounds
            });
            this.currentRound++;
        } else {
            // If the removed player was the active player, rotate turn
            const activePlayer = this.gameState.gamePlayers[this.gameState.activePlayerIndex];
            if (!activePlayer || activePlayer.id === playerId || activePlayer.folded || activePlayer.status === 'LEFT') {
                this.gameState.activePlayerIndex = this.getNextActiveIndex(this.gameState.activePlayerIndex);
            }
            this.emit('state_change', this.getPublicState());
        }
        
        return true;
    }

    startRound() {
        console.log('[DEBUG] startRound called. Total players:', this.gameState.players.length);
        
        if (this.currentRound > this.totalRounds) {
            this.isActive = false;
            return { success: false, error: "Session complete" };
        }
        
        // Filter out players who have LEFT or are eliminated
        const validPlayers = this.gameState.players.filter(p => {
            const nameValid = p.name && p.name.trim() !== '';
            const statusValid = p.status !== 'LEFT' && p.status !== 'ELIMINATED';
            return nameValid && statusValid;
        });
        
        console.log('[DEBUG] Valid players:', validPlayers.length, validPlayers);
        
        if (validPlayers.length < 2) return { success: false, error: "Not enough players" };

        const deck = shuffleDeck(createDeck());
        let deckIndex = 0;

        this.gameState.gamePlayers = validPlayers.map(p => ({
            ...p,
            status: 'BLIND',
            folded: false,
            invested: 5,
            hand: [deck[deckIndex++], deck[deckIndex++], deck[deckIndex++]]
        }));
        
        console.log('[DEBUG] gamePlayers set:', this.gameState.gamePlayers.length, this.gameState.gamePlayers);
        console.log('[DEBUG] Sample hand:', this.gameState.gamePlayers[0]?.hand);

        this.gameState.pot = this.gameState.gamePlayers.length * 5;
        this.gameState.currentStake = 20;
        this.gameState.activePlayerIndex = 0;
        this.gameState.currentLogs = [`Round ${this.currentRound} Started. Boot collected.`];
        this.gameState.phase = 'ACTIVE';
        this.gameState.sideShowRequest = null;
        this.gameState.showRequest = null;
        this.gameState.recoveredFromCrash = false;
        
        // Clear any lingering timeouts from previous round
        this.clearRequestTimeouts();

        const state = this.getPublicState();
        console.log('[DEBUG] Emitting state_change with phase:', state.phase, 'gamePlayers:', state.gamePlayers.length);
        this.emit('state_change', state);
        return { success: true };
    }

    handleAction(action) {
        // Ledger actions (operator recording physical game)
        if (action.type === 'ADD_TO_POT') {
            return this.addToPot(action.playerId, action.amount);
        }
        if (action.type === 'RECORD_WINNER') {
            return this.recordWinner(action.winnerId);
        }
        if (action.type === 'RESET_ROUND') {
            return this.resetRound();
        }
        
        // Automated game actions (for online play)
        if (action.type === 'CANCEL_SIDE_SHOW') {
            return this.cancelSideShow();
        }
        if (action.type === 'CANCEL_SHOW') {
            return this.cancelShow();
        }
        
        if (this.gameState.phase !== 'ACTIVE') return { success: false, error: "Game not active" };

        const activePlayer = this.gameState.gamePlayers[this.gameState.activePlayerIndex];
        if (!activePlayer || activePlayer.id !== action.playerId) {
            return { success: false, error: "Not your turn" };
        }

        switch (action.type) {
            case 'SEEN':
                return this.actSeen(activePlayer);
            case 'FOLD':
                return this.actFold(activePlayer);
            case 'BET':
                return this.actBet(activePlayer, action.amount, action.isDouble);
            case 'SIDE_SHOW_REQUEST':
                return this.actSideShowRequest(activePlayer, action.targetId);
            case 'SIDE_SHOW_RESOLVE':
                return this.resolveSideShow(action.winnerId);
            case 'SHOW':
                return this.requestShow(activePlayer, action.targetId);
            case 'SHOW_RESOLVE':
                return this.resolveShow(action.winnerId);
            default:
                return { success: false, error: "Invalid action" };
        }
    }

    actSeen(player) {
        player.status = 'SEEN';
        this.gameState.currentLogs.push(`${player.name} saw their cards.`);
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    actFold(player, isSideShowLoss = false) {
        player.folded = true;
        this.gameState.currentLogs.push(`${player.name} packed.`);

        const remaining = this.gameState.gamePlayers.filter(p => !p.folded);
        if (remaining.length === 1) {
            this.endHand(remaining[0]);
        } else {
            if (!isSideShowLoss) this.rotateTurn();
            this.emit('state_change', this.getPublicState());
        }
        return { success: true };
    }

    actBet(player, amountOverride, isDouble) {
        let newStake = this.gameState.currentStake;
        if (amountOverride) newStake = amountOverride;
        if (isDouble) newStake = this.gameState.currentStake * 2;

        const cost = (player.status === 'BLIND') ? newStake / 2 : newStake;

        player.invested += cost;
        this.gameState.pot += cost;
        this.gameState.currentStake = newStake;

        this.gameState.currentLogs.push(`${player.name} bets ${cost} (Chaal: ${newStake})`);

        this.rotateTurn();
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    actSideShowRequest(player, targetId) {
        if (player.status !== 'SEEN') return { success: false, error: "Must be SEEN for Side Show" };

        const target = this.gameState.gamePlayers.find(p => p.id === targetId);
        
        if (!target) return { success: false, error: "Target player not found" };
        if (target.folded) return { success: false, error: "Cannot Side Show with folded player" };
        if (target.status === 'BLIND') return { success: false, error: "Cannot Side Show with Blind player" };
        if (target.id === player.id) return { success: false, error: "Cannot request Side Show with yourself" };
        if (target.status === 'LEFT') return { success: false, error: "Cannot Side Show with a player who left" };

        const cost = this.gameState.currentStake;
        player.invested += cost;
        this.gameState.pot += cost;
        
        this.gameState.currentLogs.push(`${player.name} bets ${cost} and requested Side Show with ${target.name}`);

        this.gameState.sideShowRequest = { 
            requester: player, 
            target: target,
            timestamp: Date.now()
        };
        
        this.setRequestTimeout('sideShow', () => {
            this.gameState.currentLogs.push(`Side Show request timed out after ${this.REQUEST_TIMEOUT_MS / 1000}s`);
            this.cancelSideShow();
        });
        
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }
    
    cancelSideShow() {
        if (!this.gameState.sideShowRequest) return { success: false, error: "No side show request to cancel" };
        
        const { requester } = this.gameState.sideShowRequest;
        
        if (this.requestTimeouts.has('sideShow')) {
            clearTimeout(this.requestTimeouts.get('sideShow'));
            this.requestTimeouts.delete('sideShow');
        }
        
        this.gameState.sideShowRequest = null;
        this.gameState.currentLogs.push(`${requester.name}'s Side Show request was cancelled`);
        
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    resolveSideShow(winnerId) {
        if (!this.gameState.sideShowRequest) return { success: false, error: "No side show request" };
        
        if (this.requestTimeouts.has('sideShow')) {
            clearTimeout(this.requestTimeouts.get('sideShow'));
            this.requestTimeouts.delete('sideShow');
        }
        
        const { requester, target } = this.gameState.sideShowRequest;
        
        // Validate winnerId is either requester or target
        if (winnerId !== requester.id && winnerId !== target.id) {
            return { success: false, error: "Invalid winner ID" };
        }
        
        const winner = winnerId === requester.id ? requester : target;
        const loser = winnerId === requester.id ? target : requester;
        
        this.gameState.currentLogs.push(`Side Show: ${winner.name} wins against ${loser.name}`);
        
        const requesterIndex = this.gameState.gamePlayers.findIndex(p => p.id === requester.id);
        
        loser.folded = true;
        this.gameState.currentLogs.push(`${loser.name} packed.`);
        
        const remaining = this.gameState.gamePlayers.filter(p => !p.folded);
        if (remaining.length === 1) {
            this.gameState.sideShowRequest = null;
            this.endHand(remaining[0]);
            return { success: true };
        }
        
        this.gameState.sideShowRequest = null;
        // Turn goes to the player after the requester (not the requester themselves)
        this.gameState.activePlayerIndex = this.getNextActiveIndex(requesterIndex);
        
        this.emit('state_change', this.getPublicState());
        return { success: true, winner, loser };
    }

    requestShow(player, targetId) {
        const remaining = this.gameState.gamePlayers.filter(p => !p.folded);
        
        const target = targetId ? 
            remaining.find(p => p.id === targetId) : 
            remaining.find(p => p.id !== player.id);
        
        if (!target) return { success: false, error: "Target player not found" };
        
        const isForceShow = player.status === 'SEEN' && target.status === 'BLIND';
        const blindPlayers = remaining.filter(p => p.status === 'BLIND');
        
        if (isForceShow && blindPlayers.length > 2) {
            return { success: false, error: "Force Show only allowed when 1 or 2 blind players remain" };
        }
        
        if (!isForceShow && remaining.length !== 2) {
            return { success: false, error: "Can only Show when 2 players remain" };
        }

        this.gameState.showRequest = { 
            requester: player, 
            target: target,
            isForceShow: isForceShow,
            timestamp: Date.now()
        };
        
        if (isForceShow) {
            this.gameState.currentLogs.push(`${player.name} requested Force Show against ${target.name} (BLIND)`);
        } else {
            this.gameState.currentLogs.push(`${player.name} requested Show against ${target.name}`);
        }
        
        this.setRequestTimeout('show', () => {
            this.gameState.currentLogs.push(`Show request timed out after ${this.REQUEST_TIMEOUT_MS / 1000}s`);
            this.cancelShow();
        });
        
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }
    
    cancelShow() {
        if (!this.gameState.showRequest) return { success: false, error: "No show request to cancel" };
        
        const { requester, isForceShow } = this.gameState.showRequest;
        
        if (this.requestTimeouts.has('show')) {
            clearTimeout(this.requestTimeouts.get('show'));
            this.requestTimeouts.delete('show');
        }
        
        this.gameState.showRequest = null;
        this.gameState.currentLogs.push(`${requester.name}'s ${isForceShow ? 'Force Show' : 'Show'} request was cancelled`);
        
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    resolveShow(winnerId) {
        if (!this.gameState.showRequest) return { success: false, error: "No show request" };
        
        if (this.requestTimeouts.has('show')) {
            clearTimeout(this.requestTimeouts.get('show'));
            this.requestTimeouts.delete('show');
        }
        
        const { requester, target, isForceShow } = this.gameState.showRequest;
        
        // Validate winnerId is either requester or target
        if (winnerId !== requester.id && winnerId !== target.id) {
            return { success: false, error: "Invalid winner ID" };
        }
        
        const winner = winnerId === requester.id ? requester : target;
        const loser = winnerId === requester.id ? target : requester;
        
        if (isForceShow) {
            if (winner.id === requester.id) {
                // SEEN player wins against BLIND player
                this.gameState.currentLogs.push(`${requester.name} (SEEN) wins Force Show against ${target.name} (BLIND)`);
                target.folded = true;
                this.gameState.currentLogs.push(`${target.name} packed.`);
            } else {
                // BLIND player wins against SEEN player - SEEN player pays penalty
                const penalty = this.gameState.currentStake * 2;
                requester.invested += penalty;
                this.gameState.pot += penalty;
                requester.folded = true;
                this.gameState.currentLogs.push(`${target.name} (BLIND) wins Force Show against ${requester.name} (SEEN)`);
                this.gameState.currentLogs.push(`${requester.name} pays penalty of ${penalty} and packs.`);
            }
            
            this.gameState.showRequest = null;
            
            const requesterIndex = this.gameState.gamePlayers.findIndex(p => p.id === requester.id);
            
            const remaining = this.gameState.gamePlayers.filter(p => !p.folded);
            if (remaining.length === 1) {
                this.endHand(remaining[0]);
                return { success: true, winner, loser };
            } else {
                // Turn goes to player after requester
                this.gameState.activePlayerIndex = this.getNextActiveIndex(requesterIndex);
                this.emit('state_change', this.getPublicState());
                return { success: true, winner, loser };
            }
        } else {
            // Regular Show - both players show cards, higher hand wins
            this.gameState.currentLogs.push(`${requester.name} showed cards against ${target.name}`);
            this.gameState.showRequest = null;
            this.endHand(winner);
        }
        
        return { success: true };
    }

    rotateTurn() {
        const remaining = this.gameState.gamePlayers.filter(p => !p.folded);
        if (remaining.length === 1) {
            this.endHand(remaining[0]);
            return;
        }
        
        this.gameState.activePlayerIndex = this.getNextActiveIndex(this.gameState.activePlayerIndex);
    }

    getNextActiveIndex(currentIndex) {
        const activePlayers = this.gameState.gamePlayers.filter(p => !p.folded && p.status !== 'LEFT');
        if (activePlayers.length === 0) return currentIndex;
        if (activePlayers.length === 1) {
            return this.gameState.gamePlayers.findIndex(p => p.id === activePlayers[0].id);
        }
        
        let next = (currentIndex + 1) % this.gameState.gamePlayers.length;
        let p = this.gameState.gamePlayers[next];
        let attempts = 0;
        while ((p.folded || p.status === 'LEFT') && attempts < this.gameState.gamePlayers.length) {
            next = (next + 1) % this.gameState.gamePlayers.length;
            p = this.gameState.gamePlayers[next];
            attempts++;
        }
        return next;
    }

    getPreviousActiveIndex(currentIndex) {
        const activePlayers = this.gameState.gamePlayers.filter(p => !p.folded && p.status !== 'LEFT');
        if (activePlayers.length === 0) return currentIndex;
        if (activePlayers.length === 1) {
            return this.gameState.gamePlayers.findIndex(p => p.id === activePlayers[0].id);
        }
        
        let prev = (currentIndex - 1 + this.gameState.gamePlayers.length) % this.gameState.gamePlayers.length;
        let p = this.gameState.gamePlayers[prev];
        let attempts = 0;
        while ((p.folded || p.status === 'LEFT') && attempts < this.gameState.gamePlayers.length) {
            prev = (prev - 1 + this.gameState.gamePlayers.length) % this.gameState.gamePlayers.length;
            p = this.gameState.gamePlayers[prev];
            attempts++;
        }
        return prev;
    }

    endHand(winner) {
        this.gameState.phase = 'SHOWDOWN';
        if (winner) {
            this.gameState.currentLogs.push(`Hand Over. Winner: ${winner.name}`);
        } else {
            this.gameState.currentLogs.push('Hand Over. No winner (all players left).');
        }

        const netChanges = {};
        this.gameState.players.forEach(p => {
            const played = this.gameState.gamePlayers.find(gp => gp.id === p.id);
            if (!played) {
                netChanges[p.id] = 0;
            } else {
                if (winner && p.id === winner.id) {
                    netChanges[p.id] = this.gameState.pot - played.invested;
                    p.sessionBalance += netChanges[p.id];
                } else {
                    netChanges[p.id] = -played.invested;
                    p.sessionBalance += netChanges[p.id];
                }
            }
        });

        const completedRound = this.currentRound;
        this.currentRound++;
        
        const isSessionOver = this.currentRound > this.totalRounds;

        this.emit('state_change', this.getPublicState());
        
        this.emit('hand_complete', {
            winner,
            pot: this.gameState.pot,
            netChanges,
            currentRound: completedRound,
            isSessionOver
        });
        
        if (isSessionOver) {
            this.isActive = false;
            this.emit('session_ended', { 
                reason: 'MAX_ROUNDS_REACHED',
                finalRound: this.currentRound - 1,
                totalRounds: this.totalRounds
            });
        }
    }

    getPublicState() {
        const publicGamePlayers = this.gameState.gamePlayers.map(p => {
            const { hand, ...publicPlayer } = p;
            return publicPlayer;
        });

        return {
            players: this.gameState.players,
            gamePlayers: publicGamePlayers,
            pot: this.gameState.pot,
            currentStake: this.gameState.currentStake,
            activePlayerIndex: this.gameState.activePlayerIndex,
            currentLogs: this.gameState.currentLogs,
            phase: this.gameState.phase,
            sideShowRequest: this.gameState.sideShowRequest,
            showRequest: this.gameState.showRequest,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            gameLimitType: this.gameLimitType,
            targetScore: this.gameState.targetScore,
            recoveredFromCrash: this.gameState.recoveredFromCrash
        };
    }

    // Ledger Methods (Operator recording physical game)
    addToPot(playerId, amount) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, error: "Player not found" };
        }
        if (!amount || amount <= 0) {
            return { success: false, error: "Invalid amount" };
        }
        
        player.invested = (player.invested || 0) + amount;
        this.gameState.pot = (this.gameState.pot || 0) + amount;
        this.gameState.currentLogs.push(`${player.name} added ${amount} to pot. Total pot: ${this.gameState.pot}`);
        
        this.emit('state_change', this.getPublicState());
        return { success: true, player, pot: this.gameState.pot };
    }

    recordWinner(winnerId) {
        const winner = this.gameState.players.find(p => p.id === winnerId);
        if (!winner) {
            return { success: false, error: "Winner not found" };
        }

        this.gameState.winner = winner;
        this.gameState.currentLogs.push(`🏆 ${winner.name} wins Round ${this.currentRound}! Pot: ${this.gameState.pot}`);

        const netChanges = {};
        this.gameState.players.forEach(p => {
            const invested = p.invested || 0;
            if (p.id === winner.id) {
                netChanges[p.id] = this.gameState.pot - invested;
                p.sessionBalance = (p.sessionBalance || 0) + netChanges[p.id];
            } else {
                netChanges[p.id] = -invested;
                p.sessionBalance = (p.sessionBalance || 0) + netChanges[p.id];
            }
            // Reset invested for next round
            p.invested = 0;
        });

        this.currentRound++;
        const isSessionOver = this.currentRound > this.totalRounds;

        this.emit('state_change', this.getPublicState());
        
        this.emit('hand_complete', {
            winner,
            pot: this.gameState.pot,
            netChanges,
            currentRound: this.currentRound,
            isSessionOver
        });
        
        if (isSessionOver) {
            this.isActive = false;
            this.emit('session_ended', { 
                reason: 'MAX_ROUNDS_REACHED',
                finalRound: this.currentRound - 1,
                totalRounds: this.totalRounds
            });
        }

        return { success: true, winner, pot: this.gameState.pot };
    }

    resetRound() {
        this.gameState.pot = 0;
        this.gameState.winner = null;
        this.gameState.sideShowRequest = null;
        this.gameState.showRequest = null;
        this.gameState.currentLogs.push(`Round ${this.currentRound} reset. Starting fresh.`);
        
        this.clearRequestTimeouts();
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    endSession() {
        this.isActive = false;
        this.gameState.phase = 'ENDED';
        this.clearRequestTimeouts();
        this.emit('session_ended', {
            reason: 'MANUAL_END',
            finalRound: this.currentRound,
            totalRounds: this.totalRounds,
            players: this.gameState.players
        });
    }

    // Snapshot support for crash recovery
    getSnapshot() {
        // Remove hands from gamePlayers for privacy
        const gamePlayersWithoutHands = this.gameState.gamePlayers.map(p => {
            const { hand, ...rest } = p;
            return rest;
        });

        return {
            sessionId: this.sessionId,
            sessionName: this.sessionName,
            currentRound: this.currentRound,
            isActive: this.isActive,
            gameLimitType: this.gameLimitType,
            totalRounds: this.totalRounds,
            targetScore: this.targetScore,
            gameState: {
                players: this.gameState.players,
                pot: this.gameState.pot,
                currentStake: this.gameState.currentStake,
                activePlayerIndex: this.gameState.activePlayerIndex,
                gamePlayers: gamePlayersWithoutHands,
                currentLogs: this.gameState.currentLogs,
                phase: this.gameState.phase,
                sideShowRequest: this.gameState.sideShowRequest ? {
                    requesterId: this.gameState.sideShowRequest.requester.id,
                    targetId: this.gameState.sideShowRequest.target.id,
                    timestamp: this.gameState.sideShowRequest.timestamp
                } : null,
                showRequest: this.gameState.showRequest ? {
                    requesterId: this.gameState.showRequest.requester.id,
                    targetId: this.gameState.showRequest.target.id,
                    isForceShow: this.gameState.showRequest.isForceShow,
                    timestamp: this.gameState.showRequest.timestamp
                } : null
            },
            timestamp: Date.now()
        };
    }

    restoreSnapshot(snapshot) {
        if (!snapshot || !snapshot.gameState) return false;

        this.currentRound = snapshot.currentRound || 1;
        this.isActive = snapshot.isActive !== false;
        this.gameLimitType = snapshot.gameLimitType || 'rounds';
        this.totalRounds = snapshot.totalRounds || this.totalRounds;
        this.targetScore = snapshot.targetScore || this.targetScore;

        const gs = snapshot.gameState;
        this.gameState.players = gs.players || [];
        this.gameState.pot = gs.pot || 0;
        this.gameState.currentStake = gs.currentStake || 20;
        this.gameState.activePlayerIndex = gs.activePlayerIndex || 0;
        this.gameState.gamePlayers = gs.gamePlayers || [];
        this.gameState.currentLogs = gs.currentLogs || [];
        this.gameState.phase = gs.phase || 'SETUP';
        this.gameState.gameLimitType = this.gameLimitType;
        this.gameState.totalRounds = this.totalRounds;
        this.gameState.targetScore = this.targetScore;
        this.gameState.recoveredFromCrash = true;

        // Restore pending requests by resolving IDs back to player objects
        if (gs.sideShowRequest) {
            const requester = this.gameState.gamePlayers.find(p => p.id === gs.sideShowRequest.requesterId);
            const target = this.gameState.gamePlayers.find(p => p.id === gs.sideShowRequest.targetId);
            if (requester && target) {
                this.gameState.sideShowRequest = {
                    requester,
                    target,
                    timestamp: gs.sideShowRequest.timestamp
                };
            }
        }

        if (gs.showRequest) {
            const requester = this.gameState.gamePlayers.find(p => p.id === gs.showRequest.requesterId);
            const target = this.gameState.gamePlayers.find(p => p.id === gs.showRequest.targetId);
            if (requester && target) {
                this.gameState.showRequest = {
                    requester,
                    target,
                    isForceShow: gs.showRequest.isForceShow,
                    timestamp: gs.showRequest.timestamp
                };
            }
        }

        // Add recovery log
        this.gameState.currentLogs.push('⚠️ Session recovered from server restart. Hands were reset for security.');
        this.gameState.currentLogs.push('You may continue the current round or start a new one.');

        this.clearRequestTimeouts();
        return true;
    }
}

module.exports = GameManager;
