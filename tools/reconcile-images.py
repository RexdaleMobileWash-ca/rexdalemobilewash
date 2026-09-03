#!/usr/bin/env python3
"""Gate 5 proof: prove the bucket holds exactly what the staging directory holds.

    python3 tools/reconcile-images.py <staging-dir> <remote:bucket>

Prints, raw: counts side by side, byte totals side by side, every missing or
differing file by name with its size, and five random files compared
byte-for-byte with a fixed seed.

Exit 0 = pass. Exit 1 = the gate fails and the build stops.

The detail that matters: the combined size of the named missing files must equal
the byte gap exactly. A count match alone would not prove nothing was silently
truncated.
"""
import os, sys, json, random, hashlib, subprocess

SEED = 20260903          # fixed, so the spot-check is reproducible
SPOT = 5

def local_files(root):
    out = {}
    for dirpath, _, names in os.walk(root):
        for n in names:
            p = os.path.join(dirpath, n)
            out[os.path.relpath(p, root)] = os.path.getsize(p)
    return out

def remote_files(remote):
    raw = subprocess.run(['rclone', 'lsjson', '-R', '--files-only', remote],
                         capture_output=True, text=True, check=True).stdout
    return {e['Path']: e['Size'] for e in json.loads(raw)}

def sha(b):
    return hashlib.sha256(b).hexdigest()

def main():
    root, remote = sys.argv[1], sys.argv[2]
    L, R = local_files(root), remote_files(remote)
    lb, rb = sum(L.values()), sum(R.values())

    print(f"{'':22}{'staging':>16}{'bucket':>16}")
    print(f"{'files':22}{len(L):>16}{len(R):>16}")
    print(f"{'bytes':22}{lb:>16}{rb:>16}")
    print(f"{'difference':22}{'':>16}{rb - lb:>16}")
    print()

    missing = sorted(set(L) - set(R))
    extra   = sorted(set(R) - set(L))
    differ  = sorted(k for k in set(L) & set(R) if L[k] != R[k])

    if missing:
        print(f"MISSING from the bucket ({len(missing)}):")
        for k in missing:
            print(f"   {L[k]:>12}  {k}")
        gap = sum(L[k] for k in missing)
        print(f"   combined size of the named files : {gap}")
        print(f"   byte gap                         : {lb - rb}")
        print(f"   {'MATCH — nothing else was truncated' if gap == lb - rb else '*** MISMATCH — something else is also wrong ***'}")
        print()
    if extra:
        print(f"EXTRA in the bucket, not in staging ({len(extra)}):")
        for k in extra:
            print(f"   {R[k]:>12}  {k}")
        print()
    if differ:
        print(f"SIZE MISMATCH ({len(differ)}):")
        for k in differ:
            print(f"   staging {L[k]} vs bucket {R[k]}  {k}")
        print()

    # byte-for-byte spot check on a fixed random sample
    shared = sorted(set(L) & set(R))
    rnd = random.Random(SEED)
    sample = rnd.sample(shared, min(SPOT, len(shared))) if shared else []
    print(f"byte-for-byte spot check ({len(sample)} files, seed {SEED}):")
    bad = []
    for k in sample:
        with open(os.path.join(root, k), 'rb') as fh:
            a = fh.read()
        got = subprocess.run(['rclone', 'cat', f'{remote}/{k}'],
                             capture_output=True, check=True).stdout
        ok = sha(a) == sha(got)
        if not ok:
            bad.append(k)
        print(f"   {'OK  ' if ok else 'FAIL'}  {sha(a)[:16]}  {len(a):>10}  {k}")
    print()

    failed = bool(missing or extra or differ or bad)
    print('RESULT: ' + ('FAIL — gate 5 does not pass' if failed
                        else f'PASS — {len(L)} files / {lb} bytes / 0 differences'))
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main())
