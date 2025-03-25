const { Sequelize, DataTypes } = require("sequelize");

// 从环境变量中读取数据库配置
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;

const [host, port] = MYSQL_ADDRESS.split(":");

// 主业务数据库配置（nodejs_demo）
const testDB = new Sequelize("nodejs_demo", MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql",
  define: {
    freezeTableName: true // 全局禁用复数化
  }
});

// 问卷业务数据库配置（nxyz）
const questionnaireDB = new Sequelize("nxyz", MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql",
  define: {
    freezeTableName: true // 禁用复数化
  }
});

// 定义数据模型
const Counter = testDB.define("Counter", {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

// 添加问卷模型定义
const Questionnaire = questionnaireDB.define('questionnaire', {
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: DataTypes.TEXT,
  version: {
    type: DataTypes.STRING,
    defaultValue: '1.0.0'
  },
  is_published: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'questionnaire' // 显式指定表名
});

// 验证表名映射
console.log(Questionnaire.getTableName()); // 应该输出'questionnaire'

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await Questionnaire.sync({ alter: true });
}

// 新增数据访问方法
const getQuestionnaireWithQuestions = async (questionnaireId) => {
  return await questionnaireDB.query(`
    SELECT q.*, o.id AS option_id, o.option_text, o.score 
    FROM question q
    JOIN option o ON q.id = o.question_id
    WHERE q.questionnaire_id = :questionnaireId
    ORDER BY q.sort_order, o.sort_order
  `, {
    replacements: { questionnaireId },
    type: questionnaireDB.QueryTypes.SELECT
  });
};

const getQuestionnaireBaseInfo = async (questionnaireId) => {
  return await Questionnaire.findOne({
    where: { id: questionnaireId },
    attributes: ['id', 'title', 'description', 'version']
  });
};

// 修改导出
module.exports = {
  init,
  Counter,
  Questionnaire,
  getQuestionnaireWithQuestions,
  getQuestionnaireBaseInfo
};
