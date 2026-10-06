INSERT INTO items (slug, section, position, text, aside, label_era, label_status, label_made_of, label_text, label_kind, label_note, snapshot_url) VALUES
('digital-nachos', 'now', 1, 'growing [digital nachos](https://digitalnachos.com.au)', NULL,
  'the studio', 'live', 'plain english, fixed fees and a refund guarantee',
  'reporting pipelines, dashboards and software that take the repeated exports and spreadsheet clean-up off a team.',
  'decision', 'you only pay once it''s live and working. if the risk sits with me, i''m careful about what i promise.',
  'https://digitalnachos.com.au'),
('canberra-events', 'now', 2, 'building [canberra.events](https://canberra.events)', 'things worth leaving the house for',
  '2025 to now', 'live', 'a city calendar, local venues and a lot of local knowledge',
  'canberra doesn''t have an events problem. it has a finding-out problem. so this is one calendar for the whole city, updated every day.',
  'decision', 'start with the people who run things, not the people who scroll. if organisers can list in a minute, the calendar fills itself.',
  'https://canberra.events'),
('linear-gratis', 'now', 3, 'building [linear.gratis](https://linear.gratis)', NULL,
  'open source', 'live', 'linear''s api, public boards and feedback forms',
  'clients shouldn''t need a paid seat to see how their project is going. this turns a linear project into a live board and a feedback form anyone can open.',
  'lesson', 'i once merged a pull request here that was ai slop. i said so publicly. every line gets read now.',
  'https://linear.gratis'),
('r4r-with-me', 'now', 4, 'helping [r4r](https://runningforresilience.com) and [with-me](https://www.with-me.co/) grow through technology', NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('good-people', 'now', 5, 'looking for good people to build things with', NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('onestack', 'before', 1, 'founded and built [onestack.cloud](https://onestack.cloud)', NULL,
  'founder', 'retired', 'open-source tools in one place',
  'an early attempt at one home for a small business''s tools. it taught me most of what i know about building something people pay for.',
  NULL, NULL, 'https://onestack.cloud'),
('blocksolve', 'before', 2, '[blocksolveinfrastructure.com](https://blocksolveinfrastructure.com)', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('shecreates', 'before', 3, '[shecreatesmgmt.com](https://shecreatesmgmt.com)', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('startups', 'before', 4, 'dev and data at a few startups', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('finance-policy', 'before', 5, 'finance and policy', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
('kpmg', 'before', 6, 'management consulting at kpmg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO facts (key, title, subtitle) VALUES
('shelf', 'the scout mindset', 'julia galef'),
('kettle', 'fellow stagg', 'slightly hacked');

INSERT INTO log_entries (date, precision, text) VALUES
('2026-03-01', 'month', 'started helping with-me grow.'),
('2026-03-01', 'month', 'moved to sydney.'),
('2026-09-01', 'month', 'shipped the new digital nachos site.'),
('2026-10-01', 'month', 'working on a spring redesign for canberra.events.'),
('2026-10-03', 'day', 'redesigning this site. you''re reading a draft.');
