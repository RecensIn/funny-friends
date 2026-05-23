const EventEmitter = require('events');

class RummyLedger extends EventEmitter {
    constructor(config, sessionName, totalRounds) {
        super();
        
        if (typeof config === 'object' && config !== null) {
            this.sessionId = config.sessionId;
            this.sessionName = config.sessionName;
            this.gameLimitType = config.gameLimitType || 'points';
            this.targetScore = config.targetScore || 100;
            this.totalRounds = config.totalRounds || 999;
        } else {
            this.sessionId = config;
            this.sessionName = sessionName;
            this.targetScore = 100;
            this.totalRounds = totalRounds || 999;
            this.gameLimitType = 'points';
        }
        
        this.currentRound = 1;
        this.isActive = true;
        this.roundHistory = [];

        this.gameState = {
            players: [],
            currentLogs: [],
            phase: 'SETUP',
            gameLimitType: this.gameLimitType,
            totalRounds: this.totalRounds,
            targetScore: this.targetScore,
            winner: null,
            roundInProgress: false
        };
    }

    setPlayers(initialPlayers) {
        this.gameState.players = initialPlayers.map(p => ({
            ...p,
            status: 'PLAYING',
            score: 0,
            roundScore: 0
        }));
        if (!this.gameState.phase || this.gameState.phase === 'SETUP') {
            this.gameState.phase = 'SETUP';
        }
    }

    addPlayer(player) {
        if (this.gameState.phase !== 'SETUP') return false;
        this.gameState.players.push({
            ...player,
            status: 'PLAYING',
            score: 0,
            roundScore: 0
        });
        return true;
    }

    removePlayer(playerId) {
        const idx = this.gameState.players.findIndex(p => p.id === playerId);
        if (idx === -1) return false;
        
        if (this.gameState.phase === 'SETUP') {
            this.gameState.players.splice(idx, 1);
            return true;
        }
        
        const player = this.gameState.players[idx];
        player.status = 'LEFT';
        player.roundScore = 0;
        this.gameState.currentLogs.push(`${player.name} left the game.`);
        
        const remaining = this.gameState.players.filter(p => p.status === 'PLAYING');
        if (remaining.length <= 1) {
            const winner = remaining.length === 1 ? remaining[0] : null;
            this.endRoundWithWinner(winner);
        } else {
            this.emit('state_change', this.getPublicState());
        }
        return true;
    }

    startRound() {
        if (this.currentRound > this.totalRounds) {
            this.isActive = false;
            return { success: false, error: "Session complete" };
        }
        
        const validPlayers = this.gameState.players.filter(p => p.name && p.name.trim() !== '' && p.status === 'PLAYING');
        
        if (validPlayers.length < 2) return { success: false, error: "Need at least 2 players" };

        this.gameState.players.forEach(p => {
            if (p.status === 'PLAYING') {
                p.roundScore = 0;
            }
        });

        this.gameState.currentLogs = [
            `🎴 Round ${this.currentRound} of ${this.totalRounds} Started.`,
            `${validPlayers.length} players. Target: ${this.targetScore} pts.`,
            `Cards dealt to all players.`
        ];
        this.gameState.phase = 'ACTIVE';
        this.gameState.winner = null;
        this.gameState.roundInProgress = true;
        this.gameState.roundCompletionPhase = false;
        this.gameState.rummyDeclaredBy = null;
        this.gameState.wrongShowBy = null;

        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    handleAction(action) {
        switch (action.type) {
            case 'RECORD_INITIAL_DROP':
                return this.recordInitialDrop(action.playerId);
            case 'RECORD_MIDDLE_DROP':
                return this.recordMiddleDrop(action.playerId);
            case 'RECORD_VALID_SHOW':
                return this.recordValidShow(action.playerId);
            case 'RECORD_WRONG_SHOW':
                return this.recordWrongShow(action.playerId);
            case 'RECORD_CARD_POINTS':
                return this.recordCardPoints(action.playerId, action.points);
            case 'RECORD_WINNER':
                return this.recordWinner(action.winnerId);
            case 'END_ROUND':
                return this.endRound();
            case 'RESET_ROUND':
                return this.resetRound();
            default:
                return { success: false, error: "Invalid action" };
        }
    }

    recordInitialDrop(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return { success: false, error: "Player not found" };
        if (player.status !== 'PLAYING') return { success: false, error: "Player is not active" };
        if (!this.gameState.roundInProgress) return { success: false, error: "No round in progress" };

        const points = 20;
        player.roundScore = points;
        player.score += points;
        
        this.gameState.currentLogs.push(`✋ ${player.name} INITIAL DROP. +${points} pts (Total: ${player.score})`);
        this.checkElimination(player);
        this.checkAutoWin();
        this.emit('state_change', this.getPublicState());
        return { success: true, player, points };
    }

    recordMiddleDrop(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return { success: false, error: "Player not found" };
        if (player.status !== 'PLAYING') return { success: false, error: "Player is not active" };
        if (!this.gameState.roundInProgress) return { success: false, error: "No round in progress" };

        const points = 40;
        player.roundScore = points;
        player.score += points;
        
        this.gameState.currentLogs.push(`✋ ${player.name} MIDDLE DROP. +${points} pts (Total: ${player.score})`);
        this.checkElimination(player);
        this.checkAutoWin();
        this.emit('state_change', this.getPublicState());
        return { success: true, player, points };
    }

    checkAutoWin() {
        const activePlayers = this.gameState.players.filter(p => p.status === 'PLAYING');
        const playersNotDropped = activePlayers.filter(p => p.roundScore === 0);
        
        if (playersNotDropped.length === 1 && !this.gameState.rummyDeclaredBy && !this.gameState.wrongShowBy) {
            const lastPlayer = playersNotDropped[0];
            this.gameState.rummyDeclaredBy = lastPlayer;
            this.gameState.roundCompletionPhase = true;
            this.gameState.currentLogs.push(`🏆 ${lastPlayer.name} wins automatically! (All others dropped)`);
            
            setTimeout(() => {
                this.endRoundWithWinner(lastPlayer);
            }, 1000);
        }
    }

    recordValidShow(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return { success: false, error: "Player not found" };
        if (player.status !== 'PLAYING') return { success: false, error: "Player is not active" };
        if (!this.gameState.roundInProgress) return { success: false, error: "No round in progress" };

        player.roundScore = 0;
        this.gameState.rummyDeclaredBy = player;
        this.gameState.roundCompletionPhase = true;
        
        this.gameState.currentLogs.push(`🎉 ${player.name} declares RUMMY! 0 pts. Waiting for remaining players' points.`);
        this.checkRoundCompletion();
        this.emit('state_change', this.getPublicState());
        return { success: true, player, message: "Rummy declared. Add points for remaining players." };
    }

    recordWrongShow(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return { success: false, error: "Player not found" };
        if (player.status !== 'PLAYING') return { success: false, error: "Player is not active" };
        if (!this.gameState.roundInProgress) return { success: false, error: "No round in progress" };

        const points = 80;
        player.roundScore = points;
        player.score += points;
        
        this.gameState.wrongShowBy = player;
        this.gameState.roundCompletionPhase = true;
        
        this.gameState.currentLogs.push(`❌ ${player.name} WRONG SHOW! +${points} pts (Total: ${player.score})`);
        this.checkElimination(player);
        this.checkRoundCompletion();
        this.emit('state_change', this.getPublicState());
        return { success: true, player, message: "Wrong show. Add points for remaining players." };
    }
    
    checkRoundCompletion() {
        const activePlayers = this.gameState.players.filter(p => p.status === 'PLAYING');
        const nonDroppedPlayers = activePlayers.filter(p => p.roundScore === 0 && !this.gameState.rummyDeclaredBy);
        
        if (nonDroppedPlayers.length === 1 && activePlayers.length > 1) {
            const lastPlayer = nonDroppedPlayers[0];
            if (!this.gameState.rummyDeclaredBy) {
                this.gameState.rummyDeclaredBy = lastPlayer;
                this.gameState.currentLogs.push(`🏆 ${lastPlayer.name} wins automatically! (All others dropped)`);
            }
        }
    }

    recordCardPoints(playerId, points) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return { success: false, error: "Player not found" };
        if (player.status !== 'PLAYING') return { success: false, error: "Player is not active" };
        if (!this.gameState.roundInProgress) return { success: false, error: "No round in progress" };

        player.roundScore = points;
        player.score += points;
        
        this.gameState.currentLogs.push(`📝 ${player.name} card points: ${points}. Total: ${player.score}`);
        this.checkElimination(player);
        this.emit('state_change', this.getPublicState());
        return { success: true, player, points };
    }

    checkElimination(player) {
        if (player.score >= this.targetScore + 1) {
            player.status = 'ELIMINATED';
            this.gameState.currentLogs.push(`🚫 ${player.name} ELIMINATED! (${player.score} pts)`);
        }
    }

    endRoundWithWinner(winner) {
        this.gameState.roundInProgress = false;
        
        if (winner) {
            this.gameState.winner = winner;
        }

        const leaderboard = this.gameState.players
            .filter(p => p.status !== 'ELIMINATED' || p.roundScore > 0)
            .map(p => ({
                id: p.id,
                name: p.name,
                roundScore: p.roundScore,
                totalScore: p.score,
                score: p.score,
                status: p.status
            }))
            .sort((a, b) => a.totalScore - b.totalScore);

        const activePlayers = this.gameState.players.filter(p => p.status === 'PLAYING');
        
        let isSessionOver = false;
        let finalWinner = null;
        
        if (activePlayers.length <= 1) {
            isSessionOver = true;
            finalWinner = activePlayers.length === 1 ? activePlayers[0] : null;
            if (finalWinner) {
                this.gameState.winner = finalWinner;
                this.gameState.currentLogs.push(`🏆 ${finalWinner.name} WINS THE GAME! Last player standing.`);
            }
        }

        // Record round in history
        this.roundHistory.push({
            round: this.currentRound,
            winner: winner ? { id: winner.id, name: winner.name, totalScore: winner.score } : null,
            leaderboard: leaderboard.map(p => ({ ...p })),
            eliminated: this.gameState.players.filter(p => p.status === 'ELIMINATED').map(p => p.name)
        });

        this.gameState.currentLogs.push(`📊 Round ${this.currentRound} of ${this.totalRounds} complete!`);
        this.gameState.currentLogs.push(`📈 Leaderboard: ${leaderboard.map(p => `${p.name}(${p.totalScore})`).join(', ')}`);

        const completedRound = this.currentRound;
        
        // Advance to next round (or mark complete)
        if (!isSessionOver) {
            this.currentRound++;
            if (this.currentRound > this.totalRounds) {
                isSessionOver = true;
                finalWinner = leaderboard.length > 0 ? leaderboard[0] : null;
                if (finalWinner) {
                    this.gameState.winner = finalWinner;
                }
                this.gameState.currentLogs.push(`🏆 MAX ROUNDS REACHED! ${finalWinner?.name || 'N/A'} is the champion!`);
            }
        }

        this.emit('state_change', this.getPublicState());
        
        this.emit('round_complete', {
            round: completedRound,
            winner: winner,
            leaderboard: leaderboard,
            isSessionOver,
            finalWinner,
            roundHistory: this.roundHistory.map(r => ({
                round: r.round,
                winnerName: r.winner?.name || 'N/A',
                lowestScore: r.leaderboard[0]?.totalScore || 0
            }))
        });
        
        if (isSessionOver) {
            this.isActive = false;
            this.gameState.phase = 'ENDED';
            this.emit('session_ended', { 
                reason: 'GAME_COMPLETE',
                finalWinner: finalWinner,
                finalRound: completedRound,
                totalRounds: this.totalRounds,
                leaderboard: leaderboard,
                roundHistory: this.roundHistory
            });
        }

        return { success: true, winner, leaderboard };
    }

    endRound() {
        if (!this.gameState.roundInProgress && !this.gameState.roundCompletionPhase) {
            return { success: false, error: "No round in progress" };
        }
        
        let winner = this.gameState.rummyDeclaredBy;
        
        if (!winner) {
            const activePlayers = this.gameState.players.filter(p => p.status === 'PLAYING');
            if (activePlayers.length > 0) {
                winner = activePlayers.reduce((min, p) => p.roundScore < min.roundScore ? p : min, activePlayers[0]);
            }
        }

        this.gameState.currentLogs.push(`⏹️ Round ${this.currentRound} completed by operator.`);
        return this.endRoundWithWinner(winner);
    }

    recordWinner(winnerId) {
        const winner = this.gameState.players.find(p => p.id === winnerId);
        if (!winner) {
            return { success: false, error: "Winner not found" };
        }
        return this.endRoundWithWinner(winner);
    }

    resetRound() {
        this.gameState.players.forEach(p => {
            p.roundScore = 0;
        });
        this.gameState.winner = null;
        this.gameState.roundInProgress = false;
        this.gameState.roundCompletionPhase = false;
        this.gameState.rummyDeclaredBy = null;
        this.gameState.wrongShowBy = null;
        this.gameState.currentLogs.push(`🔄 Round ${this.currentRound} reset.`);
        
        this.emit('state_change', this.getPublicState());
        return { success: true };
    }

    endSession() {
        this.isActive = false;
        this.gameState.phase = 'ENDED';
        
        const finalLeaderboard = this.gameState.players
            .map(p => ({
                id: p.id,
                name: p.name,
                finalScore: p.score,
                score: p.score,
                totalScore: p.score,
                sessionBalance: p.score,
                status: p.status
            }))
            .sort((a, b) => a.finalScore - b.finalScore);
        
        this.emit('session_ended', {
            reason: 'MANUAL_END',
            finalRound: this.currentRound,
            totalRounds: this.totalRounds,
            finalWinner: finalLeaderboard.length > 0 ? finalLeaderboard[0] : null,
            leaderboard: finalLeaderboard,
            roundHistory: this.roundHistory
        });
    }

    getPublicState() {
        const leaderboard = this.gameState.players
            .map(p => ({
                id: p.id,
                name: p.name,
                roundScore: p.roundScore || 0,
                totalScore: p.score,
                status: p.status
            }))
            .sort((a, b) => a.totalScore - b.totalScore);

        const activePlayerIndex = this.gameState.players.findIndex(p => p.status === 'PLAYING');
        const activePlayers = this.gameState.players.filter(p => p.status === 'PLAYING');
        
        const playersNeedingPoints = activePlayers.filter(p => {
            const isDeclarer = this.gameState.rummyDeclaredBy?.id === p.id || this.gameState.wrongShowBy?.id === p.id;
            const hasPoints = p.roundScore > 0 || (p.roundScore === 0 && isDeclarer);
            return !isDeclarer && !hasPoints;
        });

        return {
            players: this.gameState.players,
            gamePlayers: this.gameState.players,
            leaderboard: leaderboard,
            currentLogs: this.gameState.currentLogs,
            phase: this.gameState.phase,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            targetScore: this.targetScore,
            gameLimitType: this.gameLimitType,
            winner: this.gameState.winner,
            roundInProgress: this.gameState.roundInProgress,
            roundCompletionPhase: this.gameState.roundCompletionPhase,
            rummyDeclaredBy: this.gameState.rummyDeclaredBy,
            wrongShowBy: this.gameState.wrongShowBy,
            playersNeedingPoints: playersNeedingPoints.length,
            activePlayerIndex: activePlayerIndex >= 0 ? activePlayerIndex : 0,
            roundHistory: this.roundHistory,
            roundsRemaining: Math.max(0, this.totalRounds - this.currentRound + (this.gameState.roundInProgress ? 0 : 1))
        };
    }
}

module.exports = RummyLedger;
