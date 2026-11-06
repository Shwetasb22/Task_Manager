const test = require('node:test');
const assert = require('node:assert/strict');
const { mentionQuery, insertMention, findMentions, splitMentions } = require('./mentions');

test('the name being typed after @ is found, including one space', () => {
  assert.deepEqual(mentionQuery('Please check @Vis', 17), { start: 13, query: 'Vis' });
  assert.deepEqual(mentionQuery('@Vishal Sh', 10), { start: 0, query: 'Vishal Sh' });
  assert.equal(mentionQuery('mail vishal@brembo', 18), null);
  assert.equal(mentionQuery('done @Vishal Shinde ok', 22), null);
});

test('picking a name inserts the full name and moves the caret after it', () => {
  assert.deepEqual(insertMention('Ask @vis today', 4, 8, 'Vishal Shinde'), { text: 'Ask @Vishal Shinde today', caret: 19 });
});

test('mentions are matched against the list, longest name first', () => {
  const names = ['Vishal', 'Vishal Shinde', 'Anjali Iyer', 'Sagar Ingle'];
  assert.deepEqual(findMentions('@vishal shinde and @Anjali Iyer, not sagar@x.com or @Sagar Ingles', names), ['Vishal Shinde', 'Anjali Iyer']);
  assert.deepEqual(findMentions('@Vishal please', names), ['Vishal']);
});

test('display splits text and mentions', () => {
  assert.deepEqual(splitMentions('Hi @Anjali Iyer, see', ['Anjali Iyer']), [
    { text: 'Hi ', mention: false }, { text: '@Anjali Iyer', mention: true }, { text: ', see', mention: false },
  ]);
});
