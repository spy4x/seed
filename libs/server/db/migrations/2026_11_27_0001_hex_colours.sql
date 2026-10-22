-- #329: tags and groups take any colour, stored as a lower-case `#rrggbb` (the domain checks it
-- with `isHexColor`). Each palette name the older rows hold becomes the hex of the colour picker's
-- preset of the same hue (`COLOR_PRESETS` of @spy4x/preact-ui), so a tag or group looks as close
-- to before as the new palette allows. A group without a colour keeps NULL.

ALTER TABLE tags DROP CONSTRAINT tags_color_check;

UPDATE tags SET color = CASE color
    WHEN 'gray' THEN '#4b5563'
    WHEN 'red' THEN '#b91c1c'
    WHEN 'orange' THEN '#c2410c'
    WHEN 'green' THEN '#15803d'
    WHEN 'blue' THEN '#1d4ed8'
    WHEN 'purple' THEN '#7e22ce'
    ELSE color
END;

ALTER TABLE tags
    ALTER COLUMN color SET DEFAULT '#4b5563',
    ADD CONSTRAINT tags_color_check CHECK (color ~ '^#[0-9a-f]{6}$');

UPDATE groups SET color = CASE color
    WHEN 'gray' THEN '#4b5563'
    WHEN 'red' THEN '#b91c1c'
    WHEN 'orange' THEN '#c2410c'
    WHEN 'green' THEN '#15803d'
    WHEN 'blue' THEN '#1d4ed8'
    WHEN 'purple' THEN '#7e22ce'
    ELSE color
END
WHERE color IS NOT NULL;

ALTER TABLE groups ADD CONSTRAINT groups_color_check CHECK (color ~ '^#[0-9a-f]{6}$');
