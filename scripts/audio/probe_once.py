import sys,json,time
from output_probe import OutputProbe
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
with OutputProbe() as p:
    print(json.dumps({'ready':True,'baseline':p.baseline_peak}),flush=True)
    request=json.loads(sys.stdin.readline())
    p.begin();p.started=time.perf_counter()-(time.time()-request['timestamp'])
    result=p.finish(timeout=8)
    print(json.dumps(result,ensure_ascii=False),flush=True)
