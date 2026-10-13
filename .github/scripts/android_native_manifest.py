"""Gera o android-native.json de uma release (ver docs/android-updates.md).

Uso: android_native_manifest.py <prev.json ou ""> <nativeHash> <versão> <force true|false>

minNativeVersion = menor versão do .apk que ainda serve. Só sobe pra esta
versão quando a parte nativa mudou (impressão digital diferente da release
anterior), quando não existe release anterior com o arquivo, ou quando o
workflow foi disparado à mão com "force_native_update".
"""
import datetime
import json
import sys


def main():
    prev_path, native_hash, version, force = sys.argv[1:5]
    prev = None
    if prev_path:
        try:
            with open(prev_path, encoding='utf-8') as f:
                prev = json.load(f)
        except Exception:
            prev = None
    if force == 'true' or not prev or prev.get('nativeHash') != native_hash or not prev.get('minNativeVersion'):
        min_native = version
    else:
        min_native = prev['minNativeVersion']
    print(json.dumps({
        'version': version,
        'nativeHash': native_hash,
        'minNativeVersion': min_native,
        'builtAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }, indent=2))


if __name__ == '__main__':
    main()
