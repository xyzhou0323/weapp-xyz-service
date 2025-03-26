const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { 
  initDB,
  Counter,
  getQuestionnaireWithQuestions,
  getQuestionnaireBaseInfo,
  createUserAnswer,
  calculateTotalScore,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  saveWechatSession,
  getWechatSession
} = require("./db");

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 微信配置参数（需要替换为实际值）
const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;
const WX_LOGIN_URL = 'https://api.weixin.qq.com/sns/jscode2session';

// 新增认证中间件
const authMiddleware = async (req, res, next) => {
    try {
        const session = req.headers.authorization?.split(' ')[1] || req.body.session;
        if (!session) {
            return res.status(401).json({ code: 401, message: '未提供会话凭证' });
        }
        
        // 查询数据库验证session有效性
        const sessionData = await getWechatSession(session); // 需要从db.js导出getWechatSession方法
        if (!sessionData || new Date() > sessionData.expiresAt) {
            return res.status(401).json({ code: 401, message: '会话已过期或无效' });
        }
        
        // 将会话信息挂载到请求对象
        req.user = { 
            openid: sessionData.openid,
            sessionKey: sessionData.sessionKey 
        };
        next();
    } catch (error) {
        console.error('认证失败:', error);
        res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 在需要认证的路由前添加中间件
app.use((req, res, next) => {
    // 仅对需要认证的路由应用中间件
    if (req.path === '/api/submit-answer') {
        return authMiddleware(req, res, next);
    }
    next();
});

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

app.get("/api/health", async (req, res) => {
  res.send("I'm ok");
});

// 获取计数
app.get("/api/count", async (req, res) => {
  // 现在可以通过req.user获取用户信息
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// 新增获取问卷接口
app.get('/api/questionnaire/:id', async (req, res) => {
  try {
    const questionnaireId = req.params.id;
    
    // 获取基础信息
    const questionnaire = await getQuestionnaireBaseInfo(questionnaireId);
    if (!questionnaire) {
      return res.status(404).json({ code: 404, message: '问卷不存在' });
    }

    // 获取题目和选项
    const questions = await getQuestionnaireWithQuestions(questionnaireId);

    console.log(questions);

    // 格式化结构
    const formatted = questions.reduce((acc, row) => {
      let question = acc.find(q => q.id === row.id);
      if (!question) {
        question = {
          id: row.id,
          sub_type: row.sub_type,
          question_text: row.question_text,
          question_type: row.question_type,
          sort_order: row.sort_order,
          weight: row.weight,
          options: []
        };
        acc.push(question);
      }
      question.options.push({
        id: row.option_id,
        option_text: row.option_text,
        score: row.score
      });
      return acc;
    }, []);

    res.json({
      code: 0,
      data: {
        id: questionnaireId,
        questions: formatted
      }
    });

  } catch (error) {
    console.error('获取问卷失败:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 修改提交答案接口
app.post('/api/submit-answer', async (req, res) => {
  const transaction = await beginTransaction();
  try {
    // 从认证信息获取用户ID
    const user_id = req.user.id; 
    const { questionnaire_id, answers } = req.body;
    
    // 验证输入
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ code: 400, message: '无效的答案数据' });
    }

    // 存储答案
    const insertedAnswers = [];
    for (const answer of answers) {
      const result = await createUserAnswer({
        user_id,
        questionnaire_id,
        question_id: answer.question_id,
        option_id: answer.option_id,
        transaction
      });
      insertedAnswers.push(result);
    }

    // 计算总分
    const totalScore = await calculateTotalScore(
      user_id, 
      questionnaire_id,
      transaction
    );

    await commitTransaction(transaction);
    
    res.json({
      code: 0,
      data: {
        total_score: totalScore,
        answer_count: insertedAnswers.length
      }
    });

  } catch (error) {
    await rollbackTransaction(transaction);
    console.error('提交失败:', error);
    res.status(500).json({ 
      code: 500, 
      message: error.message || '提交答案失败' 
    });
  }
});

// 添加登录路由
app.post('/api/login', async (req, res) => {
    try {
        const { code } = req.body;
        
        // 请求微信服务器获取session信息
        const response = await axios.get(WX_LOGIN_URL, {
            params: {
                appid: WX_APPID,
                secret: WX_SECRET,
                js_code: code,
                grant_type: 'authorization_code'
            }
        });

        const { openid, session_key, errcode, errmsg } = response.data;
        
        // 处理微信返回错误
        if (errcode) {
            return res.status(401).json({
                code: errcode,
                message: errmsg
            });
        }

        // 生成第三方session
        const thirdSession = uuidv4();
        const expiresIn = 7200; // 2小时有效期
        
        // 存储会话信息到数据库
        await saveWechatSession({
            thirdSession,
            openid,
            sessionKey: session_key,
            expiresAt: new Date(Date.now() + expiresIn * 1000)
        });

        res.json({
            code: 0,
            data: {
                session: thirdSession,
                expiresIn
            }
        });

    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({
            code: 500,
            message: '服务器内部错误'
        });
    }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  // 新增配置校验
  if (!WX_APPID || !WX_SECRET) {
    throw new Error('微信配置参数缺失，请检查环境变量');
  }
  
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
