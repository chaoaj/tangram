#!/usr/bin/env python3
"""
merge_levels.py

Append levels from `levels-new.json` into the existing `levels.json`.
Creates a backup `levels.json.bak` before writing.

Usage: python3 merge_levels.py
"""
import json
import os
import sys


BASE = 'levels.json'
NEW = 'levels-new.json'


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    if not os.path.isfile(NEW):
        print(f'{NEW} not found. Run level_maker.py first to generate it.')
        return 1
    if not os.path.isfile(BASE):
        print(f'{BASE} not found. Creating new {BASE} from {NEW}.')
        data_new = load_json(NEW)
        with open(BASE, 'w', encoding='utf-8') as f:
            json.dump(data_new, f, indent=2)
        print(f'Wrote {BASE} with {len(data_new.get("levels", []))} levels.')
        return 0

    base = load_json(BASE)
    new = load_json(NEW)

    base_levels = base.get('levels')
    if base_levels is None:
        base_levels = []
        base['levels'] = base_levels

    # Support multiple shapes of levels-new.json:
    # - { "levels": [ ... ] }
    # - single level object { "id":..., "target":..., ... }
    # - raw array [ {...}, {...} ]
    if isinstance(new, dict) and 'levels' in new and isinstance(new['levels'], list):
        new_levels = new['levels']
    elif isinstance(new, dict) and ('target' in new or 'pieces' in new):
        new_levels = [new]
    elif isinstance(new, list):
        new_levels = new
    else:
        print(f'No levels found in {NEW}. Nothing to merge.')
        return 1

    # backup
    bak = BASE + '.bak'
    with open(bak, 'w', encoding='utf-8') as f:
        json.dump(base, f, indent=2)
    print(f'Backed up original {BASE} to {bak}')

    # assign sequential ids/names to incoming levels so they continue numbering
    existing_count = len(base_levels)
    for idx, lvl in enumerate(new_levels):
        new_id = existing_count + idx + 1
        lvl['id'] = new_id
        # normalize name to 'Level N' unless a more descriptive name is provided
        lvl['name'] = f'Level {new_id}'
        base_levels.append(lvl)

    with open(BASE, 'w', encoding='utf-8') as f:
        json.dump(base, f, indent=2)

    print(f'Appended {len(new_levels)} levels from {NEW} into {BASE}. Total levels now: {len(base_levels)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
