# Heroku entry point - delegates to backend/app.py
import sys
import os

# Add backend directory to Python path
backend_path = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend_path)

# Import the Flask app from backend directory
import app as backend_app
app = backend_app.app

if __name__ == '__main__':
    # Heroku sets PORT environment variable
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    
    app.run(host='0.0.0.0', port=port, debug=debug)
