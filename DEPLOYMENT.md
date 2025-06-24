# 🚀 Heroku Deployment Guide

This project is now fully configured for deployment to Heroku while maintaining local development capabilities.

## ✅ What's Been Configured

- **heroku_app.py**: Entry point for Heroku that delegates to backend/app.py
- **Procfile**: Tells Heroku how to run your app with gunicorn
- **runtime.txt**: Specifies Python 3.11.6 for Heroku
- **requirements.txt**: Updated with gunicorn for production
- **Environment Variables**: Production config uses environment variables
- **Frontend Serving**: Production routes serve frontend files automatically
- **Database**: Configured to use /tmp/capsules.db on Heroku (ephemeral)

## Prerequisites

1. **Heroku Account**: Sign up at [heroku.com](https://heroku.com)
2. **Heroku CLI**: Install from [devcenter.heroku.com/articles/heroku-cli](https://devcenter.heroku.com/articles/heroku-cli)
3. **Git**: Make sure your project is in a git repository

## 🚀 Quick Deployment Steps

### 1. Login to Heroku
```powershell
heroku login
```

### 2. Create Heroku App
```powershell
# Replace 'your-app-name' with your desired app name (must be unique)
heroku create ethereum-time-capsule-yourname
```

### 3. Set Environment Variables
```powershell
# Set your production Pinata credentials
heroku config:set PINATA_JWT="your-actual-jwt-token"
heroku config:set PINATA_API_KEY="your-actual-api-key"
heroku config:set PINATA_SECRET_API_KEY="your-actual-secret"

# Mark as production environment  
heroku config:set HEROKU=true
heroku config:set FLASK_ENV=production
```

### 4. Deploy to Heroku
```powershell
# Add all files to git (if not already done)
git add .
git commit -m "Prepare for Heroku deployment"

# Deploy to Heroku
git push heroku main
```

### 5. Open Your App
```powershell
heroku open
```

## 🧪 Local Testing

### Test Deployment Setup
```powershell
python test_heroku_setup.py
```

### Run Locally (Development Mode)
```powershell
# Option 1: Run backend directly (recommended for development)
python backend/app.py

# Option 2: Run Heroku entry point (tests production setup)
python heroku_app.py
```

Both methods serve the frontend at `http://localhost:5000`

## 🗄️ Database Options

### Current: SQLite (Simple)
- **Local**: Uses `capsules.db` in project root
- **Heroku**: Uses `/tmp/capsules.db` (resets on app restart)
- **Pros**: Zero configuration, works immediately
- **Cons**: Data lost on Heroku restarts

### Recommended for Production: PostgreSQL
```powershell
# Add PostgreSQL addon (requires credit card verification)
heroku addons:create heroku-postgresql:mini

# Check database URL
heroku config | findstr DATABASE_URL
```

To use PostgreSQL, you'd need to modify `backend/database.py` to support both SQLite and PostgreSQL.

## 🔧 Troubleshooting

### Check Heroku Logs
```powershell
heroku logs --tail
```

### View Environment Variables
```powershell
heroku config
```

### Restart Heroku App
```powershell
heroku restart
```

### Test Local Setup
```powershell
# Run the test script
python test_heroku_setup.py

# Check if app imports correctly
python -c "import heroku_app; print('✅ Import successful')"
```

## 🌐 Alternative Hosting Options

### Railway (Recommended for Beginners)
1. Go to [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Set environment variables in Railway dashboard:
   - `PINATA_JWT`
   - `PINATA_API_KEY` 
   - `PINATA_SECRET_API_KEY`
   - `RAILWAY_ENVIRONMENT=production`
4. Railway auto-deploys from GitHub

### Render
1. Go to [render.com](https://render.com)
2. Create new Web Service from GitHub
3. Set build command: `pip install -r requirements.txt`
4. Set start command: `gunicorn heroku_app:app`
5. Add environment variables

### Split Deployment (Advanced)
- **Frontend**: Deploy to Netlify/Vercel (just the `frontend/` folder)
- **Backend**: Deploy to Railway/Render
- **Benefits**: Better CDN, separate scaling
- **Setup**: Update frontend API URLs to point to backend domain

## 📋 Production Checklist

### Before Deployment
- [ ] Test locally with `python test_heroku_setup.py`
- [ ] Verify all environment variables are set
- [ ] Test that Pinata API keys work
- [ ] Ensure frontend files load correctly

### After Deployment
- [ ] Check Heroku logs for any errors
- [ ] Test homepage loads: `https://your-app.herokuapp.com`
- [ ] Test gallery page: `https://your-app.herokuapp.com/gallery`
- [ ] Test create page: `https://your-app.herokuapp.com/create`
- [ ] Verify database API endpoints work
- [ ] Test capsule creation and retrieval

### Monitoring
- [ ] Set up Heroku log monitoring
- [ ] Monitor app performance with `heroku ps`
- [ ] Check for memory/CPU usage issues

## 🔒 Security Notes

- Your `backend/config.py` is git-ignored and won't be deployed
- Production uses environment variables instead
- Always use HTTPS in production (Heroku provides this automatically)
- Consider enabling Heroku's security features

## 💡 Local Development Tips

- Use `python backend/app.py` for development (more convenient)
- Use `python heroku_app.py` to test production setup
- Frontend files are served automatically in both modes
- Database and file storage work the same locally and on Heroku
