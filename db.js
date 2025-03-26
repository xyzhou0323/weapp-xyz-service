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

// 新增Question模型定义
const Question = questionnaireDB.define('question', {
  questionnaire_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  question_text: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  question_type: {
    type: DataTypes.ENUM('single', 'multiple'),
    defaultValue: 'single'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  weight: {
    type: DataTypes.DECIMAL(5,2),
    defaultValue: 1.00
  },
  sub_type: {
    type: DataTypes.STRING(20), // 对应VARCHAR(20)
    comment: '分量表分类',
    defaultValue: null,        // 显式设置默认值
    allowNull: true            // 允许NULL
  }
}, {
  tableName: 'question',
  timestamps: false
});

// 新增Option模型定义
const Option = questionnaireDB.define('option', {
  question_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  option_text: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  is_correct: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  score: {
    type: DataTypes.DECIMAL(5,2),
    allowNull: false
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'option',
  timestamps: false
});

// 建立模型关联
Questionnaire.hasMany(Question, {
  foreignKey: 'questionnaire_id',
  as: 'questions'
});

Question.belongsTo(Questionnaire, {
  foreignKey: 'questionnaire_id',
  as: 'questionnaire'
});

Question.hasMany(Option, {
  foreignKey: 'question_id',
  onDelete: 'CASCADE' // 级联删除
});

Option.belongsTo(Question, {
  foreignKey: 'question_id'
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
  const [option, question] = await Promise.all([
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
  const results = await questionnaireDB.query(`
    SELECT 
      IFNULL(q.sub_type, '未分类') AS sub_type,
      SUM(ua.obtained_score) AS total_score
    FROM user_answer ua
    JOIN question q ON ua.question_id = q.id
    WHERE ua.user_id = :user_id
      AND ua.questionnaire_id = :questionnaire_id
    GROUP BY q.sub_type
  `, {
    replacements: { user_id, questionnaire_id },
    type: questionnaireDB.QueryTypes.SELECT,
    transaction
  });

  // 转换为对象格式 { 分量表类型: 得分 }
  return results.reduce((acc, { sub_type, total_score }) => {
    acc[sub_type] = Number(total_score);
    return acc;
  }, {});
};

// 事务管理方法
const beginTransaction = () => questionnaireDB.transaction();
const commitTransaction = (t) => t.commit();
const rollbackTransaction = (t) => t.rollback();

// 辅助查询方法
const getOptionById = (id, transaction) => 
  Option.findByPk(id, { transaction });

const getQuestionById = (id, transaction) =>
  Question.findByPk(id, { 
    transaction,
    include: [{
      model: Questionnaire,
      as: 'questionnaire',
      required: true
    }]
  });
// 新增微信会话模型
const WechatSession = testDB.define("WechatSession", {
  thirdSession: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
    field: 'thirdSession'
  },
  openid: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  sessionKey: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expiresAt'
  }
}, {
  tableName: 'WechatSessions',
  timestamps: true,
  charset: 'utf8',
  engine: 'InnoDB'
});

// 保存会话方法（使用Sequelize实现）
async function saveWechatSession(sessionData) {
  await WechatSession.upsert(sessionData, {
    conflictFields: ['openid'], // 当openid冲突时更新记录
    returning: true
  });
}

// 添加获取会话的方法
async function getWechatSession(thirdSession) {
    return await WechatSession.findOne({
        where: {
            thirdSession: thirdSession
        }
    });
}

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await Questionnaire.sync({ 
    alter: true,
    logging: console.log // 显示生成的SQL
  });
  await UserAnswer.sync({
    alter: true,
    logging: console.log // 显示生成的SQL
  });
  await Question.sync({ alter: true });
  await Option.sync({ alter: true });
  await WechatSession.sync({ alter: true }); // 同步微信会话表
  await WechatSession.sync().then(() => {
    sequelize.query(`
      CREATE UNIQUE INDEX idx_openid_unique
      ON WechatSessions(openid)
    `);
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
}
  
const getQuestionnaireBaseInfo = async (questionnaireId) => {
  return await Questionnaire.findOne({
    where: { id: questionnaireId },
    attributes: ['id', 'title', 'description', 'version']
  });
};

// 新增用户模型定义
const User = questionnaireDB.define('user', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    username: {
        type: DataTypes.STRING(50),
        unique: true
    },
    wechat_openid: {
        type: DataTypes.STRING(100),
        unique: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'user',
    timestamps: false
});

// 修改导出
module.exports = {
  initDB: init,
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
  getQuestionById,
  Question,
  Option,
  saveWechatSession,
  getWechatSession
};

console.log('Question associations:', Question.associations);
// 应显示与Questionnaire的关联

console.log('Questionnaire associations:', Questionnaire.associations);
// 应显示与Question的关联
