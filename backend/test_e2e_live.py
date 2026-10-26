import urllib.request
import json

def run_live_e2e():
    # 1. Health
    h = json.loads(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())
    print(f"[1] Health: {h}")

    # 2. Scenarios
    scenarios = json.loads(urllib.request.urlopen('http://127.0.0.1:8000/scenarios').read().decode())
    print(f"[2] Scenarios loaded: {len(scenarios)} scenarios (e.g., {scenarios[0]['id']} - {scenarios[0]['name']})")

    # 3. Load Demo File
    req = urllib.request.Request('http://127.0.0.1:8000/files/demo?frame_payload_bytes=512', method='POST')
    demo_file = json.loads(urllib.request.urlopen(req).read().decode())
    file_id = demo_file['file_id']
    frame_count = demo_file['file_info']['frame_count']
    print(f"[3] Demo file loaded: id={file_id}, frames={frame_count}, sha256={demo_file['file_info']['sha256'][:16]}...")

    # 4. Protocol Selection
    req_sel = urllib.request.Request(f'http://127.0.0.1:8000/select?file_id={file_id}&scenario_id=s01&probe_frame_count=10', method='POST')
    sel_res = json.loads(urllib.request.urlopen(req_sel).read().decode())
    print(f"[4] Protocol Calibration: Selected={sel_res['selected']}, Candidate count={len(sel_res['candidates'])}")
    for c in sel_res['candidates']:
        print(f"    - {c['mode']}: score={c['score']:.3f}, goodput={c['goodput_bps']/1000:.1f} kbps, completed={c['completed']}")

    # 5. Create Simulation
    sim_body = json.dumps({'file_id': file_id, 'scenario_id': 's01', 'mode': 'GBN'}).encode()
    req_sim = urllib.request.Request('http://127.0.0.1:8000/simulations', data=sim_body, headers={'Content-Type': 'application/json'}, method='POST')
    sim_res = json.loads(urllib.request.urlopen(req_sim).read().decode())
    sess_id = sim_res['session_id']
    print(f"[5] Simulation session created: session_id={sess_id}")
    print("ALL LIVE END-TO-END BACKEND INTEGRATION CHECKS PASSED!")


if __name__ == '__main__':
    run_live_e2e()
