import fs from 'fs';
import path from 'path';

describe('chat message row timestamp regression', () => {
  it('does not render a toLocaleTimeString label under messages', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../components/chat/ChatMessageRow.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/toLocaleTimeString/);
  });
});
