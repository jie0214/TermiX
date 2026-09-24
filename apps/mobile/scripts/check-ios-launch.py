#!/usr/bin/env python3
"""在已安裝 App 的 iPhone 上驗證冷啟動後程序持續存活；不代表功能驗收。"""
import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True, help='devicectl 裝置識別碼')
parser.add_argument('--seconds', type=int, default=15)
args = parser.parse_args()
if args.seconds < 1:
    parser.error('--seconds 必須大於 0')

with tempfile.TemporaryDirectory(prefix='termix-launch-') as directory:
    output = Path(directory) / 'result.json'

    def device_command(*command):
        result = subprocess.run(
            ['xcrun', 'devicectl', 'device', *command[:2],
             '--device', args.device, '--json-output', str(output), *command[2:]],
            capture_output=True, text=True, timeout=45,
        )
        if result.returncode:
            raise SystemExit('FAIL：裝置操作失敗，請確認連線、解鎖與開發者模式。')
        return json.loads(output.read_text())['result']

    launched = device_command('process', 'launch', '--terminate-existing',
                              'com.jie0214.termix.mobile')
    pid = launched['process']['processIdentifier']
    deadline = time.monotonic() + args.seconds
    while True:
        processes = device_command('info', 'processes')['runningProcesses']
        if not any(process.get('processIdentifier') == pid for process in processes):
            raise SystemExit('FAIL：TermiX 冷啟動後提前結束。')
        if time.monotonic() >= deadline:
            break
        time.sleep(1)
    print(f'PASS：TermiX 冷啟動後持續運行 {args.seconds} 秒。')
