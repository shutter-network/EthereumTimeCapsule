import os
import json

DEPLOYMENT_ENV = os.environ.get('DEPLOYMENT_ENV', 'testnet')
PUBLIC_CONFIG_MAINNET_PATH = 'public_config_mainnet.json'
PUBLIC_CONFIG_TESTNET_PATH = 'public_config_testnet.json'

current_dir = os.path.dirname(os.path.abspath(__file__))
if DEPLOYMENT_ENV == 'mainnet':
    config_filename = 'public_config_mainnet.json'
else:
    config_filename = 'public_config_testnet.json'
public_config_path = os.path.join(current_dir, config_filename)

with open(public_config_path, 'r') as f:
    public_config = json.load(f)