import Journal from './pages/Journal';
import Insights from './pages/Insights';
import Goals from './pages/Goals';
import People from './pages/People';
import Users from './pages/Users';
import Login from './pages/Login';
import AITest from './pages/AITest'; // Add this
import Layout from './Layout';

export const pagesConfig = {
  Pages: {
    Journal,
    Insights,
    Goals,
    People,
    Users,
    Login,
    AITest, 
  },
  Layout,
  mainPage: 'Journal'
};