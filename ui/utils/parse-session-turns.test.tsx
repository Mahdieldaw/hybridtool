import { parseSessionTurns } from './parse-session-turns';

describe('parseSessionTurns', () => {
  test('uses persisted provider responses when embedded batch is empty', () => {
    const { map } = parseSessionTurns({
      sessionId: 'session-1',
      turns: [
        {
          userTurnId: 'user-1',
          aiTurnId: 'ai-1',
          user: {
            id: 'user-1',
            text: 'Question?',
            createdAt: 100,
          },
          batch: {
            responses: {},
            timestamp: 150,
          },
          providers: {
            chatgpt: [
              {
                providerId: 'chatgpt',
                text: 'Recovered live-path answer',
                status: 'completed',
                createdAt: 200,
                updatedAt: 220,
                meta: { modelIndex: 1 },
                responseIndex: 0,
              },
            ],
          },
          createdAt: 100,
          completedAt: 300,
        },
      ],
    });

    const aiTurn = map.get('ai-1') as any;
    expect(aiTurn?.batch?.responses?.chatgpt?.text).toBe('Recovered live-path answer');
    expect(aiTurn?.batch?.responses?.chatgpt?.modelIndex).toBe(1);
  });
});
