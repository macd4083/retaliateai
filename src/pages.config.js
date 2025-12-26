import Journal from './pages/Journal';
import Insights from './pages/Insights';
import Goals from './pages/Goals';
import People from './pages/People';
import Users from './pages/Users';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Journal": Journal,
    "Insights": Insights,
    "Goals": Goals,
    "People": People,
    "Users": Users,
}

export const pagesConfig = {
    mainPage: "Journal",
    Pages: PAGES,
    Layout: __Layout,
};