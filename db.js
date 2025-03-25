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
  },
  dialectOptions: {
    charset: 'utf8mb4',       // 显式设置字符集
    collate: 'utf8mb4_unicode_ci'
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
    type: DataTypes.STRING(100),
    allowNull: false
  },
  description: DataTypes.TEXT,
  version: {
    type: DataTypes.STRING(20),
    defaultValue: '1.0.0'
  },
  is_published: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  }
}, {
  tableName: 'questionnaire',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci'
});

// 验证表名映射
console.log(Questionnaire.getTableName()); // 应该输出'questionnaire'

// 新增用户答案模型
const UserAnswer = questionnaireDB.define('user_answer', {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  questionnaire_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  question_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  option_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  obtained_score: {
    type: DataTypes.DECIMAL(5,2),
    allowNull: false
  }
}, {
  tableName: 'user_answer',
  timestamps: false
});

// 新增数据库操作方法
const createUserAnswer = async ({ 
  user_id, 
  questionnaire_id, 
  question_id, 
  option_id, 
  transaction 
}) => {
  // 获取选项分数和题目权重
  const [[option, question]] = await Promise.all([
    getOptionById(option_id, transaction),
    getQuestionById(question_id, transaction)
  ]);

  if (!option || !question) {
    throw new Error('无效的问题或选项');
  }

  return UserAnswer.create({
    user_id,
    questionnaire_id,
    question_id,
    option_id,
    obtained_score: option.score * question.weight
  }, { transaction });
};

const calculateTotalScore = async (user_id, questionnaire_id, transaction) => {
  const [result] = await questionnaireDB.query(`
    SELECT SUM(ua.obtained_score) AS total
    FROM user_answer ua
    WHERE ua.user_id = :user_id
      AND ua.questionnaire_id = :questionnaire_id
  `, {
    replacements: { user_id, questionnaire_id },
    type: questionnaireDB.QueryTypes.SELECT,
    transaction
  });

  return result.total || 0;
};

// 事务管理方法
const beginTransaction = () => questionnaireDB.transaction();
const commitTransaction = (t) => t.commit();
const rollbackTransaction = (t) => t.rollback();

// 辅助查询方法
const getOptionById = (id, transaction) => 
  questionnaireDB.models.option.findByPk(id, { transaction });

const getQuestionById = (id, transaction) => 
  questionnaireDB.models.question.findByPk(id, { transaction });

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await Questionnaire.sync({ 
    alter: true,
    logging: console.log // 显示生成的SQL
  });
}

// 新增数据访问方法
const getQuestionnaireWithQuestions = async (questionnaireId) => {
  return await questionnaireDB.query(`
    SELECT q.*, o.id AS option_id, o.option_text, o.score 
    FROM question q
    JOIN \`option\` o ON q.id = o.question_id
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
  init: init,
  Counter,
  Questionnaire,
  UserAnswer,
  getQuestionnaireWithQuestions,
  getQuestionnaireBaseInfo,
  createUserAnswer,
  calculateTotalScore,
  beginTransaction: () => questionnaireDB.transaction(),
  commitTransaction: (t) => t.commit(),
  rollbackTransaction: (t) => t.rollback(),
  getOptionById,
  getQuestionById
};
